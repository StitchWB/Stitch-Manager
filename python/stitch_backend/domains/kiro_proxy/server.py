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
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, Request, Response
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
    
    if proxy_string.startswith(("http://", "https://", "socks5h://")):
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
    return any(host_lower.endswith(d) or host_lower == d for d in ALLOWED_DOMAINS)


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
        "x-forwarded-for",
    }
    
    for key, value in headers.items():
        if key.lower() not in skip_headers:
            cleaned[key] = value
    
    return cleaned


app = FastAPI(title="Kiro Proxy", docs_url=None, redoc_url=None)


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
    
    # Clean headers
    headers = _clean_headers(dict(request.headers))
    
    # Read body
    body = await request.body()
    
    logger.debug(
        "Proxying %s %s → %s",
        request.method, request.url.path, upstream_url
    )
    
    # Get outbound proxy if configured
    outbound_proxy = _get_outbound_proxy()
    if outbound_proxy:
        # Check if SOCKS proxy requires httpx[socks]
        if outbound_proxy.startswith(("socks5://", "socks5h://")):
            try:
                import socksio  # noqa: F401
            except ImportError:
                logger.error(
                    "SOCKS5 proxy requires 'socksio' package. Install with: pip install httpx[socks]"
                )
                return Response(
                    content="SOCKS5 proxy not supported: missing 'socksio' package. Run: pip install httpx[socks]",
                    status_code=500,
                )
        
        proxy_display = outbound_proxy.split("@")[-1] if "@" in outbound_proxy else outbound_proxy
        logger.info("Using outbound proxy: %s (DNS: %s)", 
                   proxy_display,
                   "remote" if "socks5h://" in outbound_proxy else "local")
    
    # Forward request
    async with httpx.AsyncClient(
        proxy=outbound_proxy,
        timeout=httpx.Timeout(120.0, connect=10.0),
        follow_redirects=True,
    ) as client:
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
