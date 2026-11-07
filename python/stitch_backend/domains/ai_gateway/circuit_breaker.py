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
    half_open — one probe request is allowed; success → closed, failure → open.

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
from collections import defaultdict
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

# In-process fast path; ProviderEndpoint.circuit_failures is authoritative across restart.
_recent_failures: dict[str, list[datetime]] = defaultdict(list)


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


def _as_utc(dt: datetime) -> datetime:
    """SQLite drops tzinfo on storage; re-attach UTC so comparisons hold."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


async def record_endpoint_result(
    session: AsyncSession,
    endpoint_id: str,
    success: bool,
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
            endpoint.circuit_state = "closed"
            endpoint.circuit_opened_at = None
            endpoint.circuit_retry_at = None
            endpoint.updated_at = now
            _store(endpoint, [])
            await session.flush()
        elif state == "closed" and window:
            _store(endpoint, [])
            await session.flush()
        # open: a success shouldn't arrive (circuit rejects requests), ignore.
        return

    # ── Failure ──────────────────────────────────────────────────────────
    if state == "half_open":
        # Probe failed → reopen.
        endpoint.circuit_state = "open"
        endpoint.circuit_opened_at = now
        endpoint.circuit_retry_at = now + timedelta(seconds=COOLDOWN_SECONDS)
        endpoint.updated_at = now
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


async def is_endpoint_available(
    session: AsyncSession,
    endpoint_id: str,
) -> bool:
    """Check whether an endpoint should accept requests.

    Returns ``True`` for ``closed`` and ``half_open``.  For ``open``, lazily
    transitions to ``half_open`` if ``circuit_retry_at`` has elapsed (and
    then returns ``True`` to allow one probe).  Otherwise returns ``False``.

    This function has a side effect: it may mutate ``circuit_state`` from
    ``open`` → ``half_open`` when the cooldown has expired.  This is the
    standard lazy-transition pattern for circuit breakers.

    The open→half_open transition uses an atomic UPDATE ... WHERE to ensure
    only one concurrent caller wins the transition (preventing multiple
    probe requests from escaping the circuit breaker).
    """
    svc = ProviderEndpointService(session)
    endpoint = await svc.get_by_pk(endpoint_id)
    if endpoint is None:
        return False

    now = _utcnow()
    state = endpoint.circuit_state

    if state == "closed":
        return True

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
            return int(cast("Any", result).rowcount or 0) > 0
        return False

    if state == "half_open":
        return True

    return False
