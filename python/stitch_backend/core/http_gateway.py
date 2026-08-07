"""Network gateway — single place for outbound HTTP.

Centralizes proxy resolution, circuit-breaker state, and timeout enforcement
for all outbound HTTP requests made by command handlers.

The circuit breaker prevents the 92s hang measured when a configured outbound
proxy is dead: instead of every fetcher hanging on a proxy handshake that
httpx's timeout cannot bound, the breaker validates the proxy once (5s hard
``asyncio.wait_for`` deadline) and, on failure, fails fast with
:class:`ProxyUnavailableError` so callers can serve stale cache instead of
blocking the single SQLite write connection.

Privacy rule (NON-NEGOTIABLE): when a proxy is configured but the breaker is
open, the gateway NEVER silently falls back to a direct connection — the
proxy exists to avoid leaking the user's real IP.  Callers must catch
``ProxyUnavailableError`` and degrade gracefully (stale cache, empty list).
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Final
from urllib.parse import urlparse, urlunparse

import httpx

logger = logging.getLogger(__name__)


def _mask_proxy_url(url: str | None) -> str:
    """Mask userinfo in a proxy URL for safe logging.

    Keeps scheme + host + port, replaces any userinfo (user:pass) with ``***``.
    Returns ``"<none>"`` when *url* is falsy.
    """
    if not url:
        return "<none>"
    try:
        parsed = urlparse(url)
        if parsed.username or parsed.password:
            masked_netloc = f"***@{parsed.hostname}"
            if parsed.port:
                masked_netloc += f":{parsed.port}"
            return urlunparse(parsed._replace(netloc=masked_netloc))
        return url
    except Exception:
        return "<invalid>"

# Probe endpoint for proxy validation — Google's generate_204 connectivity
# check.  Returns 204 with empty body, purpose-built for fast health probes.
# Any HTTP response (even non-204) proves the proxy can forward traffic.
_PROBE_URL: Final[str] = "http://www.gstatic.com/generate_204"

# Breaker TTL: how long a validation result is trusted before re-validating.
_BREAKER_TTL: Final[float] = 300.0  # seconds (5 min)


class ProxyUnavailableError(Exception):
    """Proxy is configured but the circuit breaker is open.

    Raised by :meth:`ProxyCircuitBreaker.get_outbound_proxy_url` when a proxy
    URL is configured but the breaker has determined the proxy is unhealthy
    and the TTL has not expired.  Callers MUST catch this and degrade
    gracefully (serve stale cache, return empty list) — they MUST NOT fall
    back to a direct connection, which would leak the user's real IP.
    """


class ProxyCircuitBreaker:
    """Circuit breaker for the outbound proxy — module-level singleton.

    States:
        closed    — proxy is healthy (or not configured); requests allowed.
        open      — proxy is configured but unhealthy; requests blocked.
        half_open — TTL expired; next call re-validates.

    The breaker caches the last validation result for ``_BREAKER_TTL`` seconds.
    Within that window, repeated callers get the cached answer without
    re-validating.  When the TTL expires, the breaker moves to half-open and
    the next ``get_outbound_proxy_url`` call triggers a fresh validation.

    When no proxy is configured (``_get_outbound_proxy()`` returns ``None``)
    the breaker is irrelevant: ``get_outbound_proxy_url`` returns ``None`` and
    ``make_client`` creates a direct-connection client.
    """

    _instance: ProxyCircuitBreaker | None = None

    @classmethod
    def instance(cls) -> ProxyCircuitBreaker:
        """Return the module-level singleton (lazily created)."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self) -> None:
        self._state: str = "closed"  # closed | open | half_open
        self._last_validated: float = 0.0
        self._last_result: bool | None = None  # None = not yet checked
        self._validated_url: str | None = None
        self._lock: asyncio.Lock = asyncio.Lock()

    def _reset(self) -> None:
        """Reset breaker state (for tests)."""
        self._state = "closed"
        self._last_validated = 0.0
        self._last_result = None
        self._validated_url = None

    def _resolve_proxy_url(self) -> str | None:
        """Read the configured outbound proxy URL (cached 5s by _get_outbound_proxy)."""
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy

        return _get_outbound_proxy()

    async def _probe(self, proxy_url: str, timeout: float) -> bool:
        """HEAD request through the proxy with a hard ``asyncio.wait_for`` deadline.

        Returns ``True`` if the proxy forwarded the request (any HTTP status),
        ``False`` on timeout or error.  The ``asyncio.wait_for`` is the hard
        deadline that bounds even a hung proxy handshake — httpx's own timeout
        cannot (proven by the 92s incident).
        """

        async def _do_probe() -> bool:
            async with httpx.AsyncClient(proxy=proxy_url, timeout=timeout) as client:
                resp = await client.head(_PROBE_URL)
                # Any HTTP response means the proxy forwarded traffic.
                return resp.status_code > 0

        try:
            return await asyncio.wait_for(_do_probe(), timeout=timeout)
        except Exception as exc:  # noqa: BLE001 — any failure = proxy unhealthy
            logger.warning("[Gateway] Proxy probe failed for %s: %r", _mask_proxy_url(proxy_url), exc)
            return False

    async def validate(self, timeout: float = 5.0) -> bool:
        """Validate the configured proxy is reachable; cache result with TTL.

        Returns ``True`` if no proxy is configured (breaker irrelevant, direct
        connections OK) or if the proxy forwarded the probe.  Returns ``False``
        if the proxy is configured but unreachable / malformed.  The result is
        cached for ``_BREAKER_TTL`` seconds; repeated callers within the TTL get
        the cached answer.
        """
        proxy_url = self._resolve_proxy_url()
        if proxy_url is None:
            # No proxy configured — breaker irrelevant, direct connections OK.
            self._state = "closed"
            self._last_result = True
            self._last_validated = time.monotonic()
            self._validated_url = None
            return True

        async with self._lock:
            # Double-check under lock: another coroutine may have validated.
            now = time.monotonic()
            if (
                self._last_result is not None
                and (now - self._last_validated) < _BREAKER_TTL
                and self._validated_url == proxy_url
            ):
                return self._last_result

            healthy = await self._probe(proxy_url, timeout)
            self._last_result = healthy
            self._last_validated = time.monotonic()
            self._validated_url = proxy_url
            self._state = "closed" if healthy else "open"
            if healthy:
                logger.info("[Gateway] Proxy validated: %s", _mask_proxy_url(proxy_url))
            else:
                logger.warning("[Gateway] Proxy unhealthy, breaker OPEN: %s", _mask_proxy_url(proxy_url))
            return healthy

    async def get_outbound_proxy_url(self) -> str | None:
        """Return the proxy URL when safe to use; raise when breaker is open.

        - No proxy configured → return ``None`` (direct connection allowed).
        - Proxy configured + breaker closed/fresh-healthy → return URL.
        - Proxy configured + breaker open (within TTL) → raise
          :class:`ProxyUnavailableError`.  NEVER fall back to a direct
          connection.
        - Proxy configured + TTL expired → half-open: re-validate, then
          either return URL (closed) or raise (open).
        """
        proxy_url = self._resolve_proxy_url()
        if proxy_url is None:
            return None

        now = time.monotonic()
        cached = self._last_result
        fresh = (now - self._last_validated) < _BREAKER_TTL
        url_unchanged = self._validated_url == proxy_url

        if cached is not None and fresh and url_unchanged:
            if cached:
                return proxy_url
            raise ProxyUnavailableError(
                f"Outbound proxy is configured but unhealthy: {_mask_proxy_url(proxy_url)}"
            )

        # TTL expired, URL changed, or never validated → half-open: re-validate.
        self._state = "half_open"
        healthy = await self.validate()
        if healthy:
            return proxy_url
        raise ProxyUnavailableError(
            f"Outbound proxy is configured but unhealthy: {_mask_proxy_url(proxy_url)}"
        )

    async def make_client(
        self,
        *,
        timeout: float = 10.0,
        use_proxy: bool = True,
    ) -> httpx.AsyncClient:
        """Async factory: create an ``httpx.AsyncClient`` with proxy + timeout resolved.

        When ``use_proxy`` is ``True`` (default), the proxy is resolved through
        the breaker.  If the breaker is open, :class:`ProxyUnavailableError` is
        raised — callers MUST catch it and degrade gracefully.

        When ``use_proxy`` is ``False``, a direct-connection client is created
        (for localhost / loopback calls where the proxy is irrelevant).

        The caller is responsible for closing the client (use ``async with``)::

            client = await gateway.make_client(timeout=10.0)
            async with client:
                resp = await client.get(url)
        """
        proxy_url = await self.get_outbound_proxy_url() if use_proxy else None
        return httpx.AsyncClient(timeout=timeout, proxy=proxy_url)


def gateway() -> ProxyCircuitBreaker:
    """Return the module-level :class:`ProxyCircuitBreaker` singleton."""
    return ProxyCircuitBreaker.instance()
