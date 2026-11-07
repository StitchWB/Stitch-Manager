"""Credential runtime_status state machine.

Drives ``Credential.runtime_status`` transitions based on the outcome of a
provider call, using the normalized :class:`ClassifiedError` vocabulary from
``adapters/base.py`` so this module never needs to know about provider-specific
exception types or HTTP status codes.

State vocabulary (matches ``Credential.runtime_status`` column comment):

    unknown | active | cooldown | rate_limited | quota_exhausted |
    auth_failed | degraded | disabled

Transition rules:

    2xx success (error is None, http_status 2xx)
        → active  (clear consecutive_failures, set last_success_at)

    auth_failed
        → auth_failed  (set status_reason, increment consecutive_failures)

    rate_limited
        → rate_limited  (set next_retry_at from retry_after_seconds if known)

    quota_exhausted
        → quota_exhausted  (set quota_reset_at + next_retry_at from
          retry_after_seconds if known, else a 15-minute default)

    server_error | transport_error
        → degraded  (increment consecutive_failures, exponential backoff
          for next_retry_at)

    model_not_found | model_access_denied | client_error | unknown
        → no credential state change  (client/upstream issue, not the
          credential's fault)

    Manual disable
        → disabled  (terminal — no automatic recovery; only
          :func:`disable_credential` sets this, and once set,
          :func:`transition_credential` refuses to move it)

    2xx success also clears quota_reset_at alongside next_retry_at.

``cooldown`` is a valid state in the vocabulary but is not set by any automatic
transition here — it is reserved for a future manual/operational cooldown
operation.  It is included in ``_VALID_STATES`` for validation only.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING

from stitch_backend.core.event_bus import event_bus
from stitch_backend.domains.ai_gateway.models import _utcnow
from stitch_backend.domains.ai_gateway.service import CredentialService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError

logger = logging.getLogger(__name__)

_VALID_STATES = frozenset({
    "unknown", "active", "cooldown", "rate_limited", "quota_exhausted",
    "auth_failed", "degraded", "disabled",
})

# Exponential backoff for degraded (server_error / transport_error) transitions.
# ponytail: simple 2^n geometric backoff with a 1-hour ceiling. Switch to a
# jittered/decorrelated backoff if retry storms become a problem under load.
_BACKOFF_BASE_SECONDS = 2
_BACKOFF_CAP_SECONDS = 3600

# без дефолта ProbeWorker перепробует квота-мёртвую креду каждый свой цикл (300с)
_QUOTA_DEFAULT_RETRY = timedelta(seconds=900)

# Rolling health/latency window; in-memory only — predictive scoring rebuilds from live traffic after a boot.
_METRICS_WINDOW_SECONDS = 300.0
_METRICS_MAXLEN = 200


@dataclass(frozen=True)
class Outcome:
    ts: float
    ok: bool
    latency_ms: float | None
    error_kind: str | None


@dataclass(frozen=True)
class MetricsSnapshot:
    count: int
    success_rate: float
    p50_latency_ms: float
    p95_latency_ms: float
    rate_limited_count: int
    server_error_count: int

    @property
    def has_data(self) -> bool:
        return self.count > 0


def _percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (p / 100.0) * (len(sorted_values) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (rank - lo)


class RollingMetrics:
    """Bounded in-memory ring buffer of recent outcomes, keyed by credential/endpoint id."""

    def __init__(
        self,
        *,
        window_seconds: float = _METRICS_WINDOW_SECONDS,
        maxlen: int = _METRICS_MAXLEN,
    ) -> None:
        self._window_seconds = window_seconds
        self._maxlen = maxlen
        self._buf: dict[str, deque[Outcome]] = defaultdict(lambda: deque(maxlen=maxlen))

    def record(
        self,
        key: str,
        *,
        ok: bool,
        latency_ms: float | None,
        error_kind: str | None = None,
        now: float | None = None,
    ) -> None:
        ts = time.monotonic() if now is None else now
        self._buf[key].append(
            Outcome(ts=ts, ok=ok, latency_ms=latency_ms, error_kind=error_kind),
        )

    def _recent(self, key: str, now: float) -> list[Outcome]:
        cutoff = now - self._window_seconds
        return [o for o in self._buf.get(key, ()) if o.ts >= cutoff]

    def snapshot(self, key: str, *, now: float | None = None) -> MetricsSnapshot:
        now = time.monotonic() if now is None else now
        recent = self._recent(key, now)
        if not recent:
            return MetricsSnapshot(0, 1.0, 0.0, 0.0, 0, 0)
        latencies = sorted(o.latency_ms for o in recent if o.latency_ms is not None)
        successes = sum(1 for o in recent if o.ok)
        return MetricsSnapshot(
            count=len(recent),
            success_rate=successes / len(recent),
            p50_latency_ms=_percentile(latencies, 50),
            p95_latency_ms=_percentile(latencies, 95),
            rate_limited_count=sum(1 for o in recent if o.error_kind == "rate_limited"),
            server_error_count=sum(1 for o in recent if o.error_kind == "server_error"),
        )

    def reset(self) -> None:
        self._buf.clear()


metrics_store = RollingMetrics()


def classify_error_kind(
    error: ClassifiedError | None,
    http_status: int | None,
) -> str | None:
    """Coarse outcome kind for the rolling window; ``None`` means success."""
    if error is not None:
        return error.category
    if http_status is None or 200 <= http_status < 300:
        return None
    if http_status == 429:
        return "rate_limited"
    if 500 <= http_status < 600:
        return "server_error"
    return "other"


def record_outcome(
    *,
    credential_id: str,
    endpoint_id: str,
    ok: bool,
    latency_ms: float | None,
    error_kind: str | None = None,
) -> None:
    """Record one outcome against both the credential and its endpoint."""
    metrics_store.record(credential_id, ok=ok, latency_ms=latency_ms, error_kind=error_kind)
    metrics_store.record(endpoint_id, ok=ok, latency_ms=latency_ms, error_kind=error_kind)


async def _emit_state_changed(credential_id: str, runtime_status: str) -> None:
    await event_bus.emit(
        "credential.state_changed",
        {"credential_id": credential_id, "runtime_status": runtime_status},
    )


def exponential_backoff(consecutive_failures: int) -> timedelta:
    """Backoff for the *n*-th consecutive failure.

    ``min(base * 2^(n-1), cap)`` — n=1 → 2s, n=2 → 4s, n=3 → 8s, …, capped at
    1 hour.  ``n < 1`` is treated as 1.
    """
    if consecutive_failures < 1:
        consecutive_failures = 1
    seconds = min(
        _BACKOFF_BASE_SECONDS * (2 ** (consecutive_failures - 1)),
        _BACKOFF_CAP_SECONDS,
    )
    return timedelta(seconds=seconds)


async def transition_credential(
    session: AsyncSession,
    credential_id: str,
    error: ClassifiedError | None,
    http_status: int | None,
) -> None:
    """Apply a state transition to a credential based on a call outcome.

    If ``error`` is ``None`` and ``http_status`` is 2xx (or ``None``), the
    credential transitions to ``active`` — clearing ``consecutive_failures``
    and setting ``last_success_at``.  This is the success / recovery path.

    Otherwise the :class:`ClassifiedError.category` selects the transition
    per the module docstring.  Categories that are not the credential's fault
    (``model_not_found``, ``client_error``, …) cause no state change.

    ``disabled`` is terminal: once a credential is manually disabled, this
    function will not move it — recovery requires :func:`disable_credential`
    to be reversed by an operator (or the credential row to be updated
    directly).
    """
    svc = CredentialService(session)
    credential = await svc.get_by_pk(credential_id)
    if credential is None:
        logger.warning("transition_credential: credential %s not found", credential_id)
        return

    # disabled is terminal — no automatic recovery.
    if credential.runtime_status == "disabled":
        return

    previous_status = credential.runtime_status
    now = _utcnow()

    # ── Success / recovery ───────────────────────────────────────────────
    if error is None and (http_status is None or 200 <= http_status < 300):
        credential.runtime_status = "active"
        credential.consecutive_failures = 0
        credential.last_success_at = now
        credential.status_reason = None
        credential.next_retry_at = None
        credential.quota_reset_at = None
        credential.updated_at = now
        await session.flush()
        if previous_status != "active":
            await _emit_state_changed(credential_id, "active")
        return

    if error is None:
        # Non-2xx without a classified error — caller didn't classify it,
        # so we can't transition meaningfully.  Leave state untouched.
        return

    category = error.category

    # ── No-op categories (not the credential's fault) ────────────────────
    if category in ("model_not_found", "model_access_denied", "client_error", "unknown"):
        logger.debug(
            "transition_credential: no state change for category %r on credential %s",
            category, credential_id,
        )
        return

    # ── Failure categories ────────────────────────────────────────────────
    if category == "auth_failed":
        credential.runtime_status = "auth_failed"
        credential.status_reason = "Authentication failed"
        credential.consecutive_failures += 1
        credential.last_failure_at = now
    elif category == "rate_limited":
        credential.runtime_status = "rate_limited"
        credential.status_reason = "Rate limited"
        if error.retry_after_seconds is not None:
            credential.next_retry_at = now + timedelta(seconds=error.retry_after_seconds)
        else:
            # ponytail: default 60s cooldown when provider doesn't send Retry-After.
            # Prevents immediate re-probe storm on next worker cycle.
            credential.next_retry_at = now + timedelta(seconds=60)
        credential.last_failure_at = now
    elif category == "quota_exhausted":
        credential.runtime_status = "quota_exhausted"
        credential.status_reason = "Quota exhausted"
        if error.retry_after_seconds is not None:
            credential.quota_reset_at = now + timedelta(seconds=error.retry_after_seconds)
        else:
            credential.quota_reset_at = now + _QUOTA_DEFAULT_RETRY
        credential.next_retry_at = credential.quota_reset_at
        credential.last_failure_at = now
    elif category in ("server_error", "transport_error"):
        credential.runtime_status = "degraded"
        credential.status_reason = (
            "Server error" if category == "server_error" else "Transport error"
        )
        credential.consecutive_failures += 1
        credential.last_failure_at = now
        credential.next_retry_at = now + exponential_backoff(credential.consecutive_failures)
    else:
        # Unknown category string — don't guess.
        logger.warning(
            "transition_credential: unhandled error category %r for credential %s",
            category, credential_id,
        )
        return

    credential.updated_at = now
    await session.flush()
    if previous_status != credential.runtime_status:
        await _emit_state_changed(credential_id, credential.runtime_status)


async def disable_credential(
    session: AsyncSession,
    credential_id: str,
    reason: str | None = None,
) -> None:
    """Manually disable a credential.

    Sets ``runtime_status = "disabled"`` — a terminal state that
    :func:`transition_credential` will not move out of automatically.
    Recovery requires an operator to re-enable the credential (e.g. via
    a direct row update or a future ``enable_credential`` helper).
    """
    svc = CredentialService(session)
    credential = await svc.get_by_pk(credential_id)
    if credential is None:
        logger.warning("disable_credential: credential %s not found", credential_id)
        return
    credential.runtime_status = "disabled"
    credential.status_reason = reason
    credential.updated_at = _utcnow()
    await session.flush()
    await _emit_state_changed(credential_id, "disabled")
