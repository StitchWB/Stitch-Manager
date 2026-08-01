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
dict because ``ProviderEndpoint`` has no column for it and the task scope
forbids modifying ``models.py``.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.domains.ai_gateway.models import ProviderEndpoint, _utcnow
from stitch_backend.domains.ai_gateway.service import ProviderEndpointService

logger = logging.getLogger(__name__)

# ── Configurable thresholds ────────────────────────────────────────────────
FAILURE_THRESHOLD = 5
"""Number of failures within ``FAILURE_WINDOW_SECONDS`` that opens the circuit."""

FAILURE_WINDOW_SECONDS = 60
"""Sliding window over which failures are counted."""

COOLDOWN_SECONDS = 30
"""How long the circuit stays open before a half-open probe is allowed."""

# In-process recent-failure tracking.
# ponytail: module-level dict — does not persist across restarts and is
# per-process. If the gateway runs as multiple workers or needs cross-restart
# circuit state, add a ``circuit_failures`` JSON column to ProviderEndpoint
# (or use a shared store like Redis) and replace this dict.
_recent_failures: dict[str, list[datetime]] = defaultdict(list)


def _prune_old_failures(endpoint_id: str, now: datetime) -> list[datetime]:
    """Drop failure timestamps older than the window. Returns the surviving list."""
    cutoff = now - timedelta(seconds=FAILURE_WINDOW_SECONDS)
    surviving = [t for t in _recent_failures[endpoint_id] if t > cutoff]
    _recent_failures[endpoint_id] = surviving
    return surviving


def _reset_failure_tracker() -> None:
    """Clear all in-process failure tracking. Intended for tests."""
    _recent_failures.clear()


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

    # ── Success ──────────────────────────────────────────────────────────
    if success:
        if state == "half_open":
            endpoint.circuit_state = "closed"
            endpoint.circuit_opened_at = None
            endpoint.circuit_retry_at = None
            endpoint.updated_at = now
            _recent_failures.pop(endpoint_id, None)
            await session.flush()
        elif state == "closed":
            _recent_failures.pop(endpoint_id, None)
        # open: a success shouldn't arrive (circuit rejects requests), ignore.
        return

    # ── Failure ──────────────────────────────────────────────────────────
    if state == "half_open":
        # Probe failed → reopen.
        endpoint.circuit_state = "open"
        endpoint.circuit_opened_at = now
        endpoint.circuit_retry_at = now + timedelta(seconds=COOLDOWN_SECONDS)
        endpoint.updated_at = now
        await session.flush()
        return

    if state == "open":
        # Already open — record the timestamp but don't extend cooldown.
        _recent_failures[endpoint_id].append(now)
        _prune_old_failures(endpoint_id, now)
        return

    # closed: track failure, maybe open.
    _recent_failures[endpoint_id].append(now)
    failures = _prune_old_failures(endpoint_id, now)

    if len(failures) >= FAILURE_THRESHOLD:
        endpoint.circuit_state = "open"
        endpoint.circuit_opened_at = now
        endpoint.circuit_retry_at = now + timedelta(seconds=COOLDOWN_SECONDS)
        endpoint.updated_at = now
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
            and now >= endpoint.circuit_retry_at
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
            return result.rowcount > 0  # type: ignore[return-value]
        return False

    if state == "half_open":
        return True

    return False
