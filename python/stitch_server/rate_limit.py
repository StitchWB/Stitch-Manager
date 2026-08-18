"""Per-IP sliding-window rate limiter for POST /activate.

Single uvicorn worker behind nginx on a VDS — an in-memory dict
``{ip: deque[float]}`` is sufficient.  The limiter is a small class so
tests can instantiate it directly with a fake clock; the /activate
endpoint uses a module-level singleton (``get_limiter``/``reset_limiter``)
that tests reset between cases.

The window is sliding: each attempt appends ``now`` to the deque, then
we drop entries older than ``now - window_seconds`` and count the
remainder.  If the count is at the limit, the request is refused with
429 + ``Retry-After``.

NOTE: EVERY attempt counts — including failed ones (wrong/expired/revoked
codes).  This is deliberate brute-force protection: an attacker probing
codes must burn the same budget as a legitimate user.  The trade-off is
that a user who typos a code several times can exhaust their window;
the default (10 attempts / 60s) leaves ample headroom for normal use.
"""

from __future__ import annotations

from collections import deque
from datetime import UTC, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable


class RateLimiter:
    """Sliding-window per-IP rate limiter.

    ``limit`` is the max attempts per ``window_seconds`` per IP.  The
    ``now`` callable lets tests inject a fake clock; production uses
    :func:`datetime.now(UTC) <datetime.now>`.
    """

    def __init__(
        self,
        *,
        limit: int,
        window_seconds: int,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._limit = limit
        self._window = window_seconds
        self._now = now or (lambda: datetime.now(UTC))
        self._buckets: dict[str, deque[float]] = {}

    def _now_ts(self) -> float:
        return self._now().timestamp()

    def check(self, ip: str) -> tuple[bool, int]:
        """Check + record an attempt for ``ip``.

        Returns ``(allowed, retry_after_seconds)``.  When allowed, the
        attempt is appended to the deque; when refused, the deque is
        unchanged (the refused request does not consume a slot).
        """
        now_ts = self._now_ts()
        bucket = self._buckets.get(ip)
        if bucket is None:
            bucket = deque()
            self._buckets[ip] = bucket
        # Drop entries outside the window.
        cutoff = now_ts - self._window
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= self._limit:
            # Refused — compute how long until the oldest entry ages out.
            retry_after = max(1, int(bucket[0] + self._window - now_ts) + 1)
            return False, retry_after
        bucket.append(now_ts)
        return True, 0

    def reset(self) -> None:
        """Clear all buckets (for tests)."""
        self._buckets.clear()


# ── Module-level singleton (mirrors alerting.py pattern) ───────────────────────

_limiter: RateLimiter | None = None


def get_limiter() -> RateLimiter:
    """Return the cached rate limiter (lazy singleton).

    Built from ``Settings.activate_rate_limit`` and
    ``Settings.activate_rate_window_seconds`` on first call.
    """
    global _limiter  # noqa: PLW0603
    if _limiter is None:
        from stitch_server.config import get_settings

        s = get_settings()
        _limiter = RateLimiter(
            limit=s.activate_rate_limit,
            window_seconds=s.activate_rate_window_seconds,
        )
    return _limiter


def set_limiter(limiter: RateLimiter | None) -> None:
    """Override the limiter (for tests)."""
    global _limiter  # noqa: PLW0603
    _limiter = limiter


def reset_limiter() -> None:
    """Clear the cached limiter (for tests)."""
    global _limiter  # noqa: PLW0603
    _limiter = None
