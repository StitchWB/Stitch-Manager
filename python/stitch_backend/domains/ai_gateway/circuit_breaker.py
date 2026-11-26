"""Endpoint-level circuit breaker.

Distinct from the per-credential state machine in ``credential_state.py``:
this tracks the health of a whole ``ProviderEndpoint`` (e.g.
``https://api.fireworks.ai``), not any individual key.  When the endpoint
itself is unhealthy (connection refused, 5xx storm), the circuit opens and
*all* requests to that endpoint are rejected until a probe succeeds.

States (stored on ``ProviderEndpoint.circuit_state``):

    closed    — normal operation; recent failures tracked in-process.
    open      — reject all requests; ``circuit_retry_at`` holds the earliest
                time to attempt a half-open probe.
    half_open — exactly one leased probe request is allowed; success → closed,
                endpoint failure → open, inconclusive outcome → short retry.

Transitions::

    closed  ──N failures in T seconds──▶  open
    open    ──after circuit_retry_at──▶  half_open   (lazy, via is_endpoint_available)
    half_open ──probe succeeds──▶  closed
    half_open ──probe fails──▶  open

The failure window (N failures in T seconds) is tracked in a module-level
dict (fast path) and mirrored to ``ProviderEndpoint.circuit_failures`` on
every change; the column is authoritative across restart.
"""

from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import update

from stitch_backend.domains.ai_gateway.models import ProviderEndpoint, _utcnow
from stitch_backend.domains.ai_gateway.service import ProviderEndpointService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ── Configurable thresholds ────────────────────────────────────────────────
FAILURE_THRESHOLD = 5
"""Number of failures within ``FAILURE_WINDOW_SECONDS`` that opens the circuit."""

FAILURE_WINDOW_SECONDS = 60
"""Sliding window over which failures are counted."""

COOLDOWN_SECONDS = 30
"""How long the circuit stays open before a half-open probe is allowed."""

HALF_OPEN_PROBE_TIMEOUT_SECONDS = 120.0
"""How long a probe may be in flight before its lease is considered lost
(e.g. the outcome was never recorded because the DB write failed) and a new
probe may be admitted."""

HALF_OPEN_PROBE_INCONCLUSIVE_RETRY_SECONDS = 2.0
"""Short retry after a probe outcome that says nothing about endpoint health.

A key-scoped or model-scoped failure must neither close nor condemn the
endpoint.  Re-opening for a short interval (rather than immediately allowing
another probe) avoids a probe-spin loop when the requested model/key is
persistently unhealthy while still letting subsequent routing rounds retest
the endpoint quickly.
"""

# In-process fast path; ProviderEndpoint.circuit_failures is authoritative across restart.
_recent_failures: dict[str, list[datetime]] = defaultdict(list)


@dataclass(frozen=True)
class ProbeLease:
    """Exclusive half-open probe admission token.

    One logical probe checks the breaker several times (route resolution and
    the executor pre-invoke re-check).  The token is carried on the routing
    result so those checks can prove they belong to the same call chain;
    independent callers have no token and are rejected while the lease is
    active.
    """

    endpoint_id: str
    token: str
    started_at: datetime


# In-process half-open probe leases: endpoint_id → lease.
# In-memory only by design — after a restart no probe can be in flight.
_half_open_probes: dict[str, ProbeLease] = {}


def _new_lease(endpoint_id: str, now: datetime) -> ProbeLease:
    return ProbeLease(
        endpoint_id=endpoint_id,
        token=uuid.uuid4().hex,
        started_at=now,
    )


def _seed_window(endpoint: ProviderEndpoint) -> list[datetime]:
    """Return the failure window for *endpoint*, seeding the in-memory cache
    from the durable ``circuit_failures`` column on first access after a
    restart."""
    if endpoint.id in _recent_failures:
        return _recent_failures[endpoint.id]
    window: list[datetime] = []
    for item in endpoint.circuit_failures or []:
        try:
            window.append(datetime.fromisoformat(item))
        except (TypeError, ValueError):
            continue
    _recent_failures[endpoint.id] = window
    return window


def _prune(window: list[datetime], now: datetime) -> list[datetime]:
    """Drop failure timestamps older than the window."""
    cutoff = now - timedelta(seconds=FAILURE_WINDOW_SECONDS)
    return [t for t in window if t > cutoff]


def _store(endpoint: ProviderEndpoint, window: list[datetime]) -> None:
    """Mirror *window* into the in-memory cache and the durable column."""
    _recent_failures[endpoint.id] = window
    endpoint.circuit_failures = [t.isoformat() for t in window] or None


def _reset_failure_tracker() -> None:
    """Clear all in-process failure tracking. Intended for tests."""
    _recent_failures.clear()
    _half_open_probes.clear()


def _as_utc(dt: datetime) -> datetime:
    """SQLite drops tzinfo on storage; re-attach UTC so comparisons hold."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def _lease_matches(current: ProbeLease | None, lease: ProbeLease | None) -> bool:
    """Whether *lease* is the active lease.

    ``lease=None`` is accepted for backwards-compatible internal callers and
    direct breaker tests.  Production routing always carries the concrete
    token, which prevents a timed-out older probe from resolving a newer one.
    """
    return lease is None or (current is not None and lease.token == current.token)


def _pop_lease_if_matches(endpoint_id: str, lease: ProbeLease | None) -> None:
    current = _half_open_probes.get(endpoint_id)
    if _lease_matches(current, lease):
        _half_open_probes.pop(endpoint_id, None)


async def record_endpoint_result(
    session: AsyncSession,
    endpoint_id: str,
    success: bool,
    *,
    lease: ProbeLease | None = None,
) -> None:
    """Record a request outcome against an endpoint and update circuit state.

    On success in ``half_open``: closes the circuit.
    On success in ``closed``: clears the recent-failure window.
    On failure in ``half_open``: reopens the circuit.
    On failure in ``closed``: appends to the window; opens the circuit if
    ``FAILURE_THRESHOLD`` failures have accumulated within
    ``FAILURE_WINDOW_SECONDS``.
    On failure in ``open``: records the timestamp (extends evidence) but
    does not extend the cooldown.

    In ``half_open`` a stale lease token is ignored: a timed-out older probe
    must not close or reopen the circuit for the probe that replaced it.
    """
    svc = ProviderEndpointService(session)
    endpoint = await svc.get_by_pk(endpoint_id)
    if endpoint is None:
        logger.warning("record_endpoint_result: endpoint %s not found", endpoint_id)
        return

    now = _utcnow()
    state = endpoint.circuit_state
    window = _seed_window(endpoint)

    # ── Success ──────────────────────────────────────────────────────────
    if success:
        if state == "half_open":
            current = _half_open_probes.get(endpoint_id)
            if not _lease_matches(current, lease):
                logger.debug(
                    "Ignoring stale half-open success for endpoint %s", endpoint_id,
                )
                return
            endpoint.circuit_state = "closed"
            endpoint.circuit_opened_at = None
            endpoint.circuit_retry_at = None
            endpoint.updated_at = now
            _half_open_probes.pop(endpoint_id, None)
            _store(endpoint, [])
            await session.flush()
        elif state == "closed" and window:
            _store(endpoint, [])
            await session.flush()
        # open: a success shouldn't arrive (circuit rejects requests), ignore.
        return

    # ── Failure ──────────────────────────────────────────────────────────
    if state == "half_open":
        current = _half_open_probes.get(endpoint_id)
        if not _lease_matches(current, lease):
            logger.debug(
                "Ignoring stale half-open failure for endpoint %s", endpoint_id,
            )
            return
        # Probe failed → reopen.
        endpoint.circuit_state = "open"
        endpoint.circuit_opened_at = now
        endpoint.circuit_retry_at = now + timedelta(seconds=COOLDOWN_SECONDS)
        endpoint.updated_at = now
        _half_open_probes.pop(endpoint_id, None)
        _store(endpoint, [])
        await session.flush()
        return

    window = _prune([*window, now], now)

    if state == "open":
        # Already open — record the timestamp but don't extend cooldown.
        _store(endpoint, window)
        await session.flush()
        return

    # closed: track failure, maybe open.
    if len(window) >= FAILURE_THRESHOLD:
        endpoint.circuit_state = "open"
        endpoint.circuit_opened_at = now
        endpoint.circuit_retry_at = now + timedelta(seconds=COOLDOWN_SECONDS)
        endpoint.updated_at = now
    _store(endpoint, window)
    await session.flush()


async def resolve_endpoint_probe_inconclusive(
    session: AsyncSession,
    endpoint_id: str,
    *,
    lease: ProbeLease | None = None,
) -> None:
    """Resolve a half-open probe whose outcome carries no endpoint evidence.

    Key-scoped and model-scoped failures are inconclusive for endpoint health:
    they must free the lease for every outcome, but must neither close the
    circuit nor arm the full failure cooldown.  The endpoint returns to
    ``open`` with a short retry delay; this serializes probes and prevents a
    spin loop while still allowing quick recovery evidence to arrive.
    """
    svc = ProviderEndpointService(session)
    endpoint = await svc.get_by_pk(endpoint_id)
    if endpoint is None or endpoint.circuit_state != "half_open":
        return
    current = _half_open_probes.get(endpoint_id)
    if not _lease_matches(current, lease):
        logger.debug(
            "Ignoring stale inconclusive probe for endpoint %s", endpoint_id,
        )
        return
    now = _utcnow()
    endpoint.circuit_state = "open"
    endpoint.circuit_opened_at = now
    endpoint.circuit_retry_at = now + timedelta(
        seconds=HALF_OPEN_PROBE_INCONCLUSIVE_RETRY_SECONDS,
    )
    endpoint.updated_at = now
    _half_open_probes.pop(endpoint_id, None)
    await session.flush()


async def check_endpoint_availability(
    session: AsyncSession,
    endpoint_id: str,
    *,
    lease: ProbeLease | None = None,
) -> tuple[bool, ProbeLease | None]:
    """Detailed availability check used by routing.

    Returns ``(available, lease)``.  In half-open state only the caller
    carrying the active lease token is admitted; independent concurrent
    callers are rejected.  The caller that wins the open→half_open transition
    receives a new lease and must pass it through the request lifecycle and
    back into outcome recording.
    """
    svc = ProviderEndpointService(session)
    endpoint = await svc.get_by_pk(endpoint_id)
    if endpoint is None:
        return False, None

    now = _utcnow()
    state = endpoint.circuit_state

    if state == "closed":
        return True, None

    if state == "open":
        if (
            endpoint.circuit_retry_at is not None
            and now >= _as_utc(endpoint.circuit_retry_at)
        ):
            # Atomic CAS: only one caller wins the open→half_open transition.
            # If another session already transitioned it, rowcount == 0.
            result = await session.execute(
                update(ProviderEndpoint)
                .where(
                    ProviderEndpoint.id == endpoint_id,
                    ProviderEndpoint.circuit_state == "open",
                )
                .values(circuit_state="half_open", updated_at=now)
            )
            await session.flush()
            if int(cast("Any", result).rowcount or 0) > 0:
                probe_lease = _new_lease(endpoint_id, now)
                _half_open_probes[endpoint_id] = probe_lease
                return True, probe_lease
            return False, None
        return False, None

    if state == "half_open":
        current = _half_open_probes.get(endpoint_id)
        if current is None:
            # Restarted while half-open (in-memory lease lost) — admit one probe.
            probe_lease = _new_lease(endpoint_id, now)
            _half_open_probes[endpoint_id] = probe_lease
            return True, probe_lease
        elapsed = (now - _as_utc(current.started_at)).total_seconds()
        if elapsed >= HALF_OPEN_PROBE_TIMEOUT_SECONDS:
            # Probe outcome never recorded — replace the lost lease.
            probe_lease = _new_lease(endpoint_id, now)
            _half_open_probes[endpoint_id] = probe_lease
            return True, probe_lease
        if lease is not None and lease.token == current.token:
            return True, current
        return False, None

    return False, None


async def is_endpoint_available(
    session: AsyncSession,
    endpoint_id: str,
) -> bool:
    """Check whether an endpoint should accept requests.

    Compatibility wrapper around :func:`check_endpoint_availability` for
    callers outside the routing lifecycle.  Production routing uses the
    detailed API because the probe lease must be propagated to the executor
    and to outcome recording.
    """
    available, _lease = await check_endpoint_availability(session, endpoint_id)
    return available
