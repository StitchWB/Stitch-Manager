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

import ipaddress
import logging
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any, cast
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

logger = logging.getLogger(__name__)

# Domains we're allowed to proxy to (Kiro + AWS)
ALLOWED_DOMAINS = {
    "kiro.dev",
    "amazonaws.com",
    "aws.amazon.com",
    "signin.aws",
    "awsapps.com",
}

# Upstream headers stripped before forwarding to the client to avoid leaking
# auth tokens, session cookies, or AWS request signatures.
# ponytail: static blocklist — add headers here if new leaks appear.
_BLOCKED_UPSTREAM_HEADERS = frozenset({
    "set-cookie",
    "www-authenticate",
    "authorization",
    "x-amz-request-id",
})

# Rate limiting — per-client-IP sliding window counter.
# ponytail: in-memory sliding window, no external deps. Sufficient for a
# single-process local proxy; one client cannot starve others (per-IP keys).
# Upgrade to a token bucket or shared store if multi-process sharding lands.
_rate_limiter: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_WINDOW = 60  # seconds
_RATE_LIMIT_MAX_REQUESTS = 100  # requests per window per client IP


def _get_client_ip(request: Request) -> str:
    """Extract client IP — prefer X-Forwarded-For (first hop), fall back to socket peer."""
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    if forwarded_for:
        # X-Forwarded-For may be a chain; the leftmost entry is the original client.
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(client_ip: str) -> bool:
    """Sliding-window rate limit check. Returns True if request is allowed.

    Records the request timestamp on a per-IP list and prunes entries older
    than the window. If the IP already has _RATE_LIMIT_MAX_REQUESTS entries
    in the window, the request is rejected (caller returns 429).
    """
    now = time.time()
    window_start = now - _RATE_LIMIT_WINDOW

    # Prune expired entries (keeps memory bounded under sustained load).
    _rate_limiter[client_ip] = [
        ts for ts in _rate_limiter[client_ip] if ts > window_start
    ]

    if len(_rate_limiter[client_ip]) >= _RATE_LIMIT_MAX_REQUESTS:
        return False

    _rate_limiter[client_ip].append(now)
    return True


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
    """Read outbound proxy from kiro-patch config.

    ponytail: cache with 5s TTL to avoid per-call disk I/O.
    """
    import time

    # Module-level cache
    if not hasattr(_get_outbound_proxy, '_cache'):
        cast("Any", _get_outbound_proxy)._cache = None
        cast("Any", _get_outbound_proxy)._cache_time = 0

    # Return cached value if fresh (< 5 seconds old)
    now = time.time()
    if now - cast("Any", _get_outbound_proxy)._cache_time < 5.0:
        return cast("str | None", cast("Any", _get_outbound_proxy)._cache)

    # Read from config and update cache
    try:
        from stitch_backend.domains.kiro_patch.service import get_config
        config = get_config()
        proxy_string = config.get("outboundProxy", "")
        result = _parse_proxy_url(proxy_string)
        cast("Any", _get_outbound_proxy)._cache = result
        cast("Any", _get_outbound_proxy)._cache_time = now
        return result
    except Exception as exc:
        logger.warning("Failed to read outbound proxy config: %s", exc)
        return cast("str | None", cast("Any", _get_outbound_proxy)._cache)  # Return stale cache on error


def _is_allowed_domain(host: str) -> bool:
    """Check if the target host is in our allowlist."""
    host_lower = host.lower()

    # Block all IP addresses (IPv4 and IPv6) to prevent SSRF.
    # Attackers can bypass a domain allowlist by pointing at IP literals,
    # e.g. 169.254.169.254 (AWS/cloud metadata), 127.0.0.1, ::1, or
    # link-local fe80::1. urlparse().hostname strips IPv6 brackets, but
    # strip them defensively in case a caller passes a raw Host header.
    host_for_ip = host_lower[1:-1] if host_lower.startswith("[") and host_lower.endswith("]") else host_lower
    try:
        ipaddress.ip_address(host_for_ip)
        return False
    except ValueError:
        pass  # Not an IP literal — fall through to domain check

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
        "referer",
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
    # Rate limit per client IP to prevent abuse / resource exhaustion.
    client_ip = _get_client_ip(request)
    if not _check_rate_limit(client_ip):
        logger.warning("Rate limit exceeded for client %s", client_ip)
        return Response(
            content="Too Many Requests",
            status_code=429,
            headers={"Retry-After": str(_RATE_LIMIT_WINDOW)},
        )

    upstream_url = _build_upstream_url(request)

    # Security: only allow known domains
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
                safe_headers = {
                    k: v for k, v in upstream_response.headers.items()
                    if k.lower() not in _BLOCKED_UPSTREAM_HEADERS
                }
                return StreamingResponse(
                    content=upstream_response.aiter_bytes(),
                    status_code=upstream_response.status_code,
                    headers=safe_headers,
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
                headers={
                    k: v for k, v in upstream_response.headers.items()
                    if k.lower() not in _BLOCKED_UPSTREAM_HEADERS
                },
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
