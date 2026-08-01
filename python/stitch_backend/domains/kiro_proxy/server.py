"""Kiro Proxy — reverse proxy for Kiro IDE traffic.

Intercepts all HTTP/HTTPS requests from Kiro IDE (injected via extension.js patch)
and forwards them to the original upstream servers based on X-Forwarded-* headers.

Architecture:
    Kiro IDE → (proxy inject) → 127.0.0.1:5580 → (this server) → [outbound proxy] → runtime.us-east-1.kiro.dev

The extension.js patch adds X-Forwarded-Host/Proto/Port headers so we know
where to forward the request.

Outbound proxy support:
    If configured, all requests are routed through an external proxy (HTTP/SOCKS5)
    before reaching the upstream server. This enables geo-spoofing and IP rotation.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)

# Domains we're allowed to proxy to (Kiro + AWS)
ALLOWED_DOMAINS = {
    "kiro.dev",
    "amazonaws.com",
    "aws.amazon.com",
    "signin.aws",
    "awsapps.com",
}


def _parse_proxy_url(proxy_string: str) -> str | None:
    """Parse proxy string in various formats and return a normalized URL.
    
    Supported formats:
        - http://user:pass@host:port
        - socks5://user:pass@host:port (DNS resolved locally — NOT recommended)
        - socks5h://user:pass@host:port (DNS resolved on proxy — RECOMMENDED)
        - host:port:user:pass → socks5h://user:pass@host:port (auto-converts to remote DNS)
        - host:port (no auth) → socks5h://host:port
        - user:pass@host:port → socks5h://user:pass@host:port
    
    Returns:
        Normalized proxy URL (e.g., "socks5h://user:pass@host:port") or None if invalid.
    
    Note:
        Always prefer socks5h:// over socks5:// to prevent DNS leaks.
        socks5h resolves DNS on the proxy side, hiding domain queries from local DNS.
    """
    if not proxy_string or not proxy_string.strip():
        return None
    
    proxy_string = proxy_string.strip()
    
    # Already has scheme — check if it's socks5 (local DNS) and upgrade to socks5h (remote DNS)
    if proxy_string.startswith("socks5://"):
        logger.warning("Proxy uses socks5:// (local DNS) — upgrading to socks5h:// (remote DNS) to prevent DNS leak")
        return proxy_string.replace("socks5://", "socks5h://", 1)
    
    if proxy_string.startswith(("http://", "https://")):
        # ponytail: warn about DNS leak with HTTP proxies
        logger.warning(
            "Proxy uses HTTP/HTTPS scheme — DNS queries will be resolved locally, "
            "potentially leaking target domains. Consider using SOCKS5h for remote DNS resolution."
        )
        return proxy_string
    
    if proxy_string.startswith("socks5h://"):
        return proxy_string
    
    # Format: host:port:user:pass
    parts = proxy_string.split(":")
    if len(parts) == 4:
        host, port, user, password = parts
        # Use SOCKS5h for remote DNS resolution (prevents DNS leak)
        return f"socks5h://{user}:{password}@{host}:{port}"
    
    # Format: host:port (no auth)
    if len(parts) == 2:
        host, port = parts
        return f"socks5h://{host}:{port}"
    
    # Format: user:pass@host:port
    if "@" in proxy_string:
        # Use SOCKS5h if no scheme
        return f"socks5h://{proxy_string}"
    
    logger.warning("Could not parse proxy string: %s", proxy_string)
    return None


def _get_outbound_proxy() -> str | None:
    """Read outbound proxy from kiro-patch config."""
    try:
        from stitch_backend.domains.kiro_patch.service import get_config
        config = get_config()
        proxy_string = config.get("outboundProxy", "")
        return _parse_proxy_url(proxy_string)
    except Exception as exc:
        logger.warning("Failed to read outbound proxy config: %s", exc)
        return None


def _is_allowed_domain(host: str) -> bool:
    """Check if the target host is in our allowlist."""
    host_lower = host.lower()
    # ponytail: require dot prefix to prevent SSRF via subdomain confusion
    # e.g., "evilkiro.dev" should NOT match "kiro.dev"
    return any(host_lower == d or host_lower.endswith("." + d) for d in ALLOWED_DOMAINS)


def _build_upstream_url(request: Request) -> str:
    """Reconstruct the original upstream URL from X-Forwarded-* headers."""
    forwarded_host = request.headers.get("X-Forwarded-Host", "")
    forwarded_proto = request.headers.get("X-Forwarded-Proto", "https")
    forwarded_port = request.headers.get("X-Forwarded-Port", "443")
    
    if not forwarded_host:
        # Fallback: use the Host header (shouldn't happen with our inject)
        forwarded_host = request.headers.get("Host", "runtime.us-east-1.kiro.dev")
    
    # Build URL
    port_suffix = f":{forwarded_port}" if forwarded_port not in ("80", "443") else ""
    url = f"{forwarded_proto}://{forwarded_host}{port_suffix}{request.url.path}"
    
    if request.url.query:
        url += f"?{request.url.query}"
    
    return url


def _clean_headers(headers: dict[str, str]) -> dict[str, str]:
    """Remove hop-by-hop headers and our X-Forwarded-* headers before forwarding."""
    cleaned = {}
    skip_headers = {
        "host", "connection", "keep-alive", "transfer-encoding",
        "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
        "x-forwarded-for", "accept-language",
        # ponytail: strip Client Hints and other geo-leak vectors
        "sec-ch-ua", "sec-ch-ua-platform", "sec-ch-ua-mobile",
        "referer", "accept-encoding",
    }
    
    for key, value in headers.items():
        if key.lower() not in skip_headers:
            cleaned[key] = value
    
    return cleaned


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Create the shared httpx.AsyncClient on startup, close it on shutdown.

    ponytail: one client for the whole process — connection pooling across
    requests. Outbound proxy is read once at startup; config changes need a
    process restart to apply (same trade-off as kiro_gateway/router.py).
    """
    outbound_proxy = _get_outbound_proxy()
    if outbound_proxy:
        if outbound_proxy.startswith(("socks5://", "socks5h://")):
            try:
                import socksio  # noqa: F401
            except ImportError:
                logger.error(
                    "SOCKS5 proxy requires 'socksio' package. Install with: pip install httpx[socks]"
                )
        proxy_display = outbound_proxy.split("@")[-1] if "@" in outbound_proxy else outbound_proxy
        logger.info(
            "Using outbound proxy: %s (DNS: %s)",
            proxy_display,
            "remote" if "socks5h://" in outbound_proxy else "local",
        )

    # ponytail: follow_redirects=False — redirects would bypass _is_allowed_domain.
    # If redirects become needed, handle explicitly with a domain check on each Location.
    app.state.http_client = httpx.AsyncClient(
        proxy=outbound_proxy,
        timeout=httpx.Timeout(120.0, connect=10.0),
        follow_redirects=False,
    )
    try:
        yield
    finally:
        await app.state.http_client.aclose()


app = FastAPI(title="Kiro Proxy", docs_url=None, redoc_url=None, lifespan=lifespan)


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
async def proxy_request(request: Request, path: str) -> Response:
    """Catch-all route that proxies requests to the original upstream."""
    upstream_url = _build_upstream_url(request)
    
    # Security: only allow known domains
    from urllib.parse import urlparse
    parsed = urlparse(upstream_url)
    if not _is_allowed_domain(parsed.hostname or ""):
        logger.warning("Blocked proxy request to disallowed domain: %s", parsed.hostname)
        return Response(
            content=f"Blocked: domain {parsed.hostname} not in allowlist",
            status_code=403,
        )
    
    # WebSocket upgrade requests bypass the proxy (inject code routes them direct)
    upgrade = request.headers.get("upgrade", "")
    if "websocket" in upgrade.lower():
        logger.warning(
            "WebSocket upgrade request detected for %s — bypassing proxy (not supported)",
            upstream_url,
        )
        return Response(content="WebSocket not supported", status_code=501)

    # Clean headers
    headers = _clean_headers(dict(request.headers))
    
    # Read body
    body = await request.body()
    
    logger.debug(
        "Proxying %s %s → %s",
        request.method, request.url.path, upstream_url
    )
    
    # Forward request — shared client created at startup (connection pooling,
    # outbound proxy + SOCKS check + follow_redirects=False all set in lifespan)
    client = request.app.state.http_client
    try:
        # Check if response is streaming (SSE)
        accept = request.headers.get("accept", "")
        is_streaming = "text/event-stream" in accept or "stream" in path.lower()
        
        if is_streaming:
            # Stream response back
            async with client.stream(
                method=request.method,
                url=upstream_url,
                headers=headers,
                content=body,
            ) as upstream_response:
                return StreamingResponse(
                    content=upstream_response.aiter_bytes(),
                    status_code=upstream_response.status_code,
                    headers=dict(upstream_response.headers),
                    media_type=upstream_response.headers.get("content-type"),
                )
        else:
            # Regular request
            upstream_response = await client.request(
                method=request.method,
                url=upstream_url,
                headers=headers,
                content=body,
            )
            
            return Response(
                content=upstream_response.content,
                status_code=upstream_response.status_code,
                headers=dict(upstream_response.headers),
                media_type=upstream_response.headers.get("content-type"),
            )
            
    except httpx.RequestError as exc:
        logger.error("Proxy request failed: %s → %s", upstream_url, exc)
        return Response(
            content=f"Proxy error: {exc}",
            status_code=502,
        )


@app.get("/health")
async def health() -> dict[str, Any]:
    """Health check endpoint."""
    return {"status": "ok", "service": "kiro-proxy"}


async def _proxy_websocket_via_socks5(
    websocket: WebSocket,
    target_host: str,
    target_port: int,
    proxy_url: str,
    path: str,
) -> None:
    """Proxy WebSocket connection through SOCKS5 proxy using aiohttp + aiohttp-socks.
    
    Establishes a WebSocket connection through the SOCKS5 proxy and performs
    bidirectional message forwarding between the client and upstream.
    """
    import asyncio
    import aiohttp
    from aiohttp_socks import ProxyConnector
    
    # Build WebSocket URL
    ws_url = f"wss://{target_host}:{target_port}/{path}"
    
    # Create SOCKS proxy connector
    connector = ProxyConnector.from_url(proxy_url)
    
    try:
        await websocket.accept()
        
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.ws_connect(ws_url) as upstream_ws:
                async def forward_client_to_upstream():
                    try:
                        while True:
                            message = await websocket.receive()
                            if message["type"] == "websocket.receive":
                                if "bytes" in message and message["bytes"]:
                                    await upstream_ws.send_bytes(message["bytes"])
                                elif "text" in message and message["text"]:
                                    await upstream_ws.send_str(message["text"])
                            elif message["type"] == "websocket.disconnect":
                                await upstream_ws.close()
                                break
                    except Exception as e:
                        logger.debug("Client→upstream forwarding ended: %s", e)
                
                async def forward_upstream_to_client():
                    try:
                        async for msg in upstream_ws:
                            if msg.type == aiohttp.WSMsgType.BINARY:
                                await websocket.send_bytes(msg.data)
                            elif msg.type == aiohttp.WSMsgType.TEXT:
                                await websocket.send_text(msg.data)
                            elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.CLOSED):
                                break
                            elif msg.type == aiohttp.WSMsgType.ERROR:
                                logger.error("Upstream WebSocket error: %s", upstream_ws.exception())
                                break
                    except Exception as e:
                        logger.debug("Upstream→client forwarding ended: %s", e)
                
                # Run both directions concurrently
                await asyncio.gather(
                    forward_client_to_upstream(),
                    forward_upstream_to_client(),
                    return_exceptions=True,
                )
    
    except Exception as e:
        logger.error("SOCKS5 WebSocket proxy failed: %s", e)
        try:
            await websocket.close(code=1011, reason=f"Proxy error: {e}")
        except Exception:
            pass


@app.websocket("/{path:path}")
async def websocket_proxy(websocket: WebSocket, path: str) -> None:
    """WebSocket proxy endpoint that routes through outbound proxy.
    
    Accepts WebSocket upgrade from Kiro IDE, establishes CONNECT tunnel
    through the configured outbound proxy, and performs bidirectional
    message forwarding.
    """
    # Extract target host from X-Forwarded headers (set by JS inject)
    target_host = websocket.headers.get("x-forwarded-host", "")
    target_proto = websocket.headers.get("x-forwarded-proto", "wss")
    target_port_str = websocket.headers.get("x-forwarded-port", "443")
    
    if not target_host:
        # Fallback: use Host header
        target_host = websocket.headers.get("host", "runtime.us-east-1.kiro.dev")
    
    try:
        target_port = int(target_port_str)
    except ValueError:
        target_port = 443
    
    # Security: only allow known domains
    if not _is_allowed_domain(target_host):
        logger.warning("Blocked WebSocket to disallowed domain: %s", target_host)
        await websocket.close(code=1008, reason="Domain not in allowlist")
        return
    
    # Get outbound proxy config
    outbound_proxy = _get_outbound_proxy()
    
    logger.info(
        "WebSocket proxy: %s:%d → %s",
        target_host, target_port,
        outbound_proxy or "direct"
    )
    
    if outbound_proxy and outbound_proxy.startswith(("socks5://", "socks5h://")):
        # Use SOCKS5 proxy for WebSocket
        await _proxy_websocket_via_socks5(
            websocket, target_host, target_port, outbound_proxy, path
        )
    else:
        # Direct connection (no proxy or HTTP proxy - HTTP proxy doesn't support WS)
        if outbound_proxy and outbound_proxy.startswith(("http://", "https://")):
            # ponytail: block WebSocket when HTTP proxy configured to prevent IP leak
            # HTTP proxies don't support WebSocket CONNECT tunnel, so we can't proxy WS
            # Blocking is safer than falling back to direct (which would leak real IP)
            logger.error(
                "WebSocket blocked: HTTP proxy doesn't support WS tunneling. "
                "Use SOCKS5 proxy for WebSocket support."
            )
            await websocket.close(code=1008, reason="HTTP proxy incompatible with WebSocket")
            return
        
        try:
            # Use websockets library for direct connection (no proxy configured)
            import websockets
            
            await websocket.accept()
            
            ws_url = f"{target_proto}://{target_host}:{target_port}/{path}"
            
            async with websockets.connect(ws_url) as upstream_ws:
                async def forward_client():
                    try:
                        async for message in websocket:
                            await upstream_ws.send(message)
                    except WebSocketDisconnect:
                        pass
                
                async def forward_upstream():
                    try:
                        async for message in upstream_ws:
                            await websocket.send(message)
                    except websockets.exceptions.ConnectionClosed:
                        pass
                
                import asyncio
                await asyncio.gather(
                    forward_client(),
                    forward_upstream(),
                    return_exceptions=True,
                )
        
        except Exception as e:
            logger.error("Direct WebSocket proxy failed: %s", e)
            try:
                await websocket.close(code=1011, reason=f"Proxy error: {e}")
            except Exception:
                pass
