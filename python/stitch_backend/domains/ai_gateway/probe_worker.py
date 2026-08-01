"""ProbeWorker — periodic background task that probes credential health.

Runs every ``interval_seconds`` (default 300s), iterates over credentials in
non-active runtime states (``cooldown``, ``rate_limited``, ``quota_exhausted``,
``auth_failed``, ``degraded``), filters by ``next_retry_at <= now`` (or NULL),
probes each via ``adapter.probe_credential(...)``, and transitions the
credential via ``credential_state.transition_credential(...)``.

Start/stop lifecycle mirrors ``KeyHealthWorker``::

    await ProbeWorker.start()
    await ProbeWorker.stop()
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import get_adapter
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    ProviderEndpoint,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialService,
    ProviderEndpointService,
)

logger = logging.getLogger(__name__)

# Credentials in these states are candidates for recovery probing.
# ponytail: "unknown" is included so a freshly-created credential whose first
# probe hasn't run yet still gets probed by the worker — trade-off is one
# extra probe call per unknown credential on the first pass. Drop "unknown"
# here if probe volume becomes a concern.
_PROBE_STATES = (
    "cooldown",
    "rate_limited",
    "quota_exhausted",
    "auth_failed",
    "degraded",
    "unknown",
)


class ProbeWorker:
    """Periodic credential health probe loop."""

    _task: asyncio.Task[None] | None = None
    _interval_seconds: int = 300

    # ── Lifecycle ────────────────────────────────────────────────────────────

    @classmethod
    async def start(cls, *, interval_seconds: int = 300) -> None:
        """Start the periodic probe loop."""
        if cls._task is not None:
            logger.warning("ProbeWorker already running")
            return
        cls._interval_seconds = interval_seconds
        cls._task = asyncio.create_task(cls._loop())
        logger.info("ProbeWorker started — interval=%ds", interval_seconds)

    @classmethod
    async def stop(cls) -> None:
        """Stop the periodic probe loop."""
        if cls._task is None:
            return
        cls._task.cancel()
        try:
            await cls._task
        except asyncio.CancelledError:
            pass
        cls._task = None
        logger.info("ProbeWorker stopped")

    @classmethod
    def status(cls) -> dict[str, Any]:
        return {
            "running": cls._task is not None and not cls._task.done(),
            "intervalSeconds": cls._interval_seconds,
        }

    # ── Loop ─────────────────────────────────────────────────────────────────

    @classmethod
    async def _loop(cls) -> None:
        while True:
            try:
                await asyncio.sleep(cls._interval_seconds)
                await run_in_session(cls._probe_all)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("ProbeWorker loop error — will retry")

    # ── Core probe logic ─────────────────────────────────────────────────────

    @classmethod
    async def _probe_all(cls, session: AsyncSession) -> None:
        """Probe all credentials in non-active states that are due for retry."""
        start = time.monotonic()
        now = _utcnow()

        result = await session.execute(
            select(Credential).where(
                Credential.runtime_status.in_(_PROBE_STATES),
                or_(Credential.next_retry_at.is_(None), Credential.next_retry_at <= now),
            ),
        )
        credentials = list(result.scalars().all())

        if not credentials:
            logger.debug("ProbeWorker: no credentials to probe")
            return

        logger.info("ProbeWorker: probing %d credentials", len(credentials))

        for cred in credentials:
            try:
                async with session.begin_nested():
                    await cls._probe_one(session, cred)
            except Exception:
                logger.exception(
                    "ProbeWorker: failed for credential %s", cred.id,
                )
                # savepoint auto-rolled back; outer transaction continues

        elapsed = time.monotonic() - start
        logger.info("ProbeWorker: pass complete in %.1fs", elapsed)

    @classmethod
    async def _probe_one(cls, session: AsyncSession, credential: Credential) -> None:
        """Probe one credential and transition it based on the result."""
        ep_svc = ProviderEndpointService(session)
        endpoint = await ep_svc.get_by_pk(credential.provider_endpoint_id)
        if endpoint is None:
            logger.warning(
                "ProbeWorker: endpoint %s not found for credential %s",
                credential.provider_endpoint_id, credential.id,
            )
            return

        cred_svc = CredentialService(session)
        secret = await cred_svc.get_secret_for_invocation(credential.id)
        if not secret:
            logger.warning(
                "ProbeWorker: no secret for credential %s", credential.id,
            )
            return

        adapter = get_adapter(endpoint.adapter_type)
        probe = await adapter.probe_credential(
            base_url=endpoint.base_url,
            secret=secret,
            default_headers=endpoint.default_headers,
        )

        from stitch_backend.domains.ai_gateway import credential_state
        from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError

        if probe.success:
            await credential_state.transition_credential(
                session, credential.id,
                error=None, http_status=probe.http_status,
            )
            logger.info(
                "ProbeWorker: credential %s recovered → active", credential.id,
            )
        else:
            # Build a ClassifiedError from the probe result using the adapter.
            # Pass http_status directly — avoids constructing fake httpx
            # Request/Response objects that couple to httpx internals.
            if probe.http_status is not None:
                classified = adapter.classify_error(
                    RuntimeError(probe.error or f"HTTP {probe.http_status}"),
                    http_status=probe.http_status,
                )
            else:
                # Transport error (no HTTP status)
                classified = ClassifiedError(category="transport_error", is_endpoint_wide=True)
            await credential_state.transition_credential(
                session, credential.id,
                error=classified,
                http_status=probe.http_status,
            )
            logger.info(
                "ProbeWorker: credential %s still unhealthy (%s)",
                credential.id, classified.category,
            )

        await session.flush()
