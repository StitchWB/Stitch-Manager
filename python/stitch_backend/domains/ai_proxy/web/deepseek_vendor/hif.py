"""x-hif-* signature header fetcher/cache for the DeepSeek vendor core."""
import threading
import time

from .logger import get_logger

# invariant: logger name must stay "adapter" (ds2api.adapter) after the split
log = get_logger("adapter")

# Upstream hif signature headers, cached for the TTL from the x-hif-ttl response header (600s).
HIF_LEIM_URL = "https://hif-leim.deepseek.com/query"
HIF_DLIQ_URL = "https://hif-dliq.deepseek.com/query"


class _HifProvider:
    """Best-effort fetcher/cache for the ``x-hif-leim`` / ``x-hif-dliq``
    signature headers.

    Any failure (network, non-200, bad payload) degrades to no hif headers
    — the upstream currently accepts requests without them, so the main
    request must never fail because of hif. A stale cached value is reused
    if a refresh fails (better than dropping the header mid-session).
    """

    def __init__(self, client=None):
        self._client = client
        self._cache: dict[str, tuple[str, float]] = {}
        self._lock = threading.Lock()

    def _fetch(self, url: str) -> tuple[str, float] | None:
        if self._client is None:
            return None
        try:
            resp = self._client.get(url, timeout=10)
            if resp.status_code != 200:
                return None
            try:
                ttl = float(resp.headers.get("x-hif-ttl", "600") or 600)
            except (TypeError, ValueError):
                ttl = 600.0
            value = resp.json().get("data", {}).get("biz_data", {}).get("value")
            if not value:
                return None
            return str(value), max(ttl, 1.0)
        except Exception as e:
            log.warning("hif_fetch_failed", extra={"url": url, "error": str(e)[:120]})
            return None

    def _get(self, key: str, url: str) -> str | None:
        now = time.time()
        with self._lock:
            hit = self._cache.get(key)
            if hit is not None and hit[1] > now:
                return hit[0]
        fetched = self._fetch(url)
        if fetched is None:
            with self._lock:
                hit = self._cache.get(key)
                return hit[0] if hit else None
        value, ttl = fetched
        with self._lock:
            self._cache[key] = (value, now + ttl)
        return value

    def headers(self) -> dict:
        """Return ``{x-hif-leim: ..., x-hif-dliq: ...}`` or ``{}`` on failure."""
        out = {}
        leim = self._get("leim", HIF_LEIM_URL)
        if leim:
            out["X-Hif-Leim"] = leim
        dliq = self._get("dliq", HIF_DLIQ_URL)
        if dliq:
            out["X-Hif-Dliq"] = dliq
        return out
