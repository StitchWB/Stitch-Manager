"""Community service — friends loader + AiApiRadar proxy with TTL cache.

Stateless: friends are read from a bundled JSON file (loaded once, cached
in memory); radar offers/stats are proxied from the AiApiRadar API with a
120-second in-memory TTL cache to avoid hammering the upstream on every
page refresh.

Performance design (kills the ~4s perceived latency on warm/repeated
queries):

  - **Shared HTTP client** — a lazily-created module-level singleton
    ``httpx.AsyncClient`` replaces per-call clients, so the TLS handshake
    + connection-pool cost is paid once.

  - **In-flight deduplication** — concurrent identical requests (e.g.
    React StrictMode double-fetch in dev) await ONE upstream call via a
    ``cache-key -> Future`` map; the entry is removed on completion.

  - **Stale-while-revalidate** — a stale cache entry (age > TTL) is
    returned immediately and a background refresh is scheduled (at most
    one per key).  Refresh failures only log; the stale entry is kept.

  - **Startup warmup** — :func:`warm_radar_cache` fire-and-forgets
    background fetches for stats + default offers so the first
    user-facing request hits the cache.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path

import httpx

from stitch_backend.config import get_settings
from stitch_backend.core.exceptions import StitchError

from .models import FriendItem, RadarOffersParams

logger = logging.getLogger(__name__)

# ── Friends loader ─────────────────────────────────────────────────────────────

_FRIENDS_PATH = Path(__file__).resolve().parent / "friends.json"
_friends_cache: list[dict] | None = None


def load_friends() -> list[dict]:
    """Load and validate ``friends.json`` once; return list of plain dicts.

    The file is read once on first call and cached for the process lifetime.
    Each entry is validated through :class:`FriendItem` so malformed keys
    are caught early rather than leaking to the frontend.
    """
    global _friends_cache
    if _friends_cache is not None:
        return _friends_cache

    try:
        raw = json.loads(_FRIENDS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Failed to load friends.json: %s", exc)
        raise StitchError(f"Community friends data unavailable: {exc}") from exc

    if not isinstance(raw, list):
        raise StitchError("Community friends data unavailable: expected a JSON array")

    _friends_cache = [
        FriendItem.model_validate(entry).model_dump(mode="json")
        for entry in raw
    ]
    return _friends_cache


# ── Radar proxy: TTL cache + stale-while-revalidate + in-flight dedup ──────────

_RADAR_CACHE: dict[tuple, tuple[float, dict]] = {}
_RADAR_CACHE_TTL: float = 120.0
_RADAR_TIMEOUT: float = 10.0

# In-flight dedup: cache-key -> Future.  Concurrent identical requests await
# ONE upstream call; the entry is removed on completion (success or failure)
# so a later cold miss can re-fire.
_INFLIGHT: dict[tuple, asyncio.Future[dict]] = {}

# Keys with an active background refresh.  Guards SWR so at most one refresh
# per key is scheduled even if many callers hit a stale entry simultaneously.
_REFRESHING: set[tuple] = set()

# Lazily-created singleton HTTP client.  Reused across calls to avoid paying
# the connection-pool / TLS handshake cost on every request.  Created inside
# the running loop on first use; if a previously created client is closed
# (e.g. after a loop restart) a fresh one is created.
_HTTP_CLIENT: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    """Return the lazily-created singleton HTTP client.

    Created on first use inside the running event loop (callers are always
    async).  If the previous client was closed, a new one is created.
    """
    global _HTTP_CLIENT
    if _HTTP_CLIENT is not None and not _HTTP_CLIENT.is_closed:
        return _HTTP_CLIENT
    _HTTP_CLIENT = httpx.AsyncClient(timeout=_RADAR_TIMEOUT)
    return _HTTP_CLIENT


def _cache_set(key: tuple, payload: dict) -> None:
    """Store payload with current monotonic timestamp (atomic replace)."""
    _RADAR_CACHE[key] = (time.monotonic(), payload)


async def _radar_get(path: str, params: dict[str, str]) -> dict:
    """GET ``{AIRADAR_API_URL}{path}`` and return the JSON payload.

    Uses the shared singleton HTTP client.  Raises :class:`StitchError`
    (``"AiApiRadar unavailable: ..."``) on any transport, HTTP-status, or
    JSON-decode failure.
    """
    base_url = get_settings().airadadar_api_url.rstrip("/")
    url = f"{base_url}{path}"
    client = _get_http_client()
    try:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError as exc:
        raise StitchError(f"AiApiRadar unavailable: {exc}") from exc
    except ValueError as exc:
        # json.JSONDecodeError is a ValueError subclass
        raise StitchError("AiApiRadar unavailable: invalid JSON response") from exc


async def _fetch_with_dedup(key: tuple, path: str, params: dict[str, str]) -> dict:
    """Fetch upstream, deduplicating concurrent identical requests.

    If an identical request is already in flight, await its Future instead
    of firing a second upstream call.  The Future is removed on completion
    (success or failure) so a later cold miss can re-fire.
    """
    existing = _INFLIGHT.get(key)
    if existing is not None:
        return await existing

    loop = asyncio.get_running_loop()
    fut: asyncio.Future[dict] = loop.create_future()
    _INFLIGHT[key] = fut
    try:
        payload = await _radar_get(path, params)
        _cache_set(key, payload)
        if not fut.done():
            fut.set_result(payload)
        return payload
    except BaseException as exc:
        # Catches Exception + CancelledError (BaseException in 3.8+) so the
        # future is always resolved and the in-flight entry always removed.
        if not fut.done():
            fut.set_exception(exc)
        raise
    finally:
        _INFLIGHT.pop(key, None)
        # Retrieve any exception to suppress the "Future exception was never
        # retrieved" warning when no concurrent awaiter was present (e.g.
        # single-caller cold miss, or background refresh with no waiters).
        if not fut.cancelled():
            fut.exception()


def _schedule_refresh(key: tuple, path: str, params: dict[str, str]) -> None:
    """Schedule a background refresh for a stale cache entry.

    Guards against duplicate refreshes: if a refresh is already running
    for ``key`` (tracked in ``_REFRESHING``), do nothing.  On refresh
    failure the stale entry is kept (not evicted) so subsequent callers
    continue to get fast stale responses; the failure is only logged.
    """
    if key in _REFRESHING:
        return
    _REFRESHING.add(key)

    async def _refresh() -> None:
        try:
            await _fetch_with_dedup(key, path, params)
        except Exception as exc:  # noqa: BLE001 -- refresh failures must not surface
            logger.warning("AiApiRadar background refresh failed for %s: %s", key, exc)
        finally:
            _REFRESHING.discard(key)

    asyncio.get_running_loop().create_task(_refresh())


async def _fetch_cached(cache_key: tuple, path: str, params: dict[str, str]) -> dict:
    """Return cached payload (fresh or stale-with-refresh) or wait for upstream.

    Fresh (age <= TTL) -> return cached.  Stale but present -> return stale
    immediately and schedule a background refresh.  No entry -> wait for
    upstream (deduplicated against concurrent identical requests).
    """
    entry = _RADAR_CACHE.get(cache_key)
    if entry is not None:
        ts, payload = entry
        if time.monotonic() - ts <= _RADAR_CACHE_TTL:
            return payload  # fresh
        # Stale — return immediately, refresh in background.
        _schedule_refresh(cache_key, path, params)
        return payload

    # Cold miss — wait for upstream (deduplicated).
    return await _fetch_with_dedup(cache_key, path, params)


async def fetch_radar_offers(params: RadarOffersParams) -> dict:
    """Proxy ``GET /api/offers`` with validated query params + TTL cache."""
    query = params.to_query()
    cache_key = ("offers",) + tuple(sorted(query.items()))
    return await _fetch_cached(cache_key, "/api/offers", query)


async def fetch_radar_stats() -> dict:
    """Proxy ``GET /api/stats`` with TTL cache (no params)."""
    return await _fetch_cached(("stats",), "/api/stats", {})


async def warm_radar_cache() -> None:
    """Fire-and-forget background tasks to prewarm the radar cache.

    Fetches stats + default offers (limit=500, no other params) through
    the same cached path so the first user-facing request hits the cache
    instead of waiting on the upstream.  Safe to call from app lifespan;
    failures are logged and never surface to the caller.
    """
    try:
        default_params = RadarOffersParams.model_validate({"limit": 500})
        loop = asyncio.get_running_loop()
        loop.create_task(fetch_radar_offers(default_params))
        loop.create_task(fetch_radar_stats())
    except Exception as exc:  # noqa: BLE001 -- warmup must never block startup
        logger.warning("AiApiRadar cache warmup failed: %s", exc)
