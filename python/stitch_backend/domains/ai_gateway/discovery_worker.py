"""DiscoveryWorker — periodic background task that discovers upstream models.

Runs every ``interval_seconds`` (default 3600s), iterates over all enabled
:class:`ProviderEndpoint` rows, picks one active credential per endpoint,
calls ``adapter.list_models(...)``, and upserts :class:`UpstreamModel` +
:class:`CredentialModelAccess` rows for every model ID returned.

Start/stop lifecycle mirrors ``KeyHealthWorker``::

    await DiscoveryWorker.start()
    await DiscoveryWorker.stop()
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import get_adapter
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialModelAccess,
    ProviderEndpoint,
    UpstreamModel,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialModelAccessService,
    CredentialService,
    ProviderEndpointService,
    UpstreamModelService,
)

logger = logging.getLogger(__name__)


class DiscoveryWorker:
    """Periodic upstream-model discovery loop."""

    _task: asyncio.Task[None] | None = None
    _interval_seconds: int = 3600

    # ── Lifecycle ────────────────────────────────────────────────────────────

    @classmethod
    async def start(cls, *, interval_seconds: int = 3600) -> None:
        """Start the periodic discovery loop."""
        if cls._task is not None:
            logger.warning("DiscoveryWorker already running")
            return
        cls._interval_seconds = interval_seconds
        cls._task = asyncio.create_task(cls._loop())
        logger.info("DiscoveryWorker started — interval=%ds", interval_seconds)

    @classmethod
    async def stop(cls) -> None:
        """Stop the periodic discovery loop."""
        if cls._task is None:
            return
        cls._task.cancel()
        try:
            await cls._task
        except asyncio.CancelledError:
            pass
        cls._task = None
        logger.info("DiscoveryWorker stopped")

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
                await run_in_session(cls._discover_all)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("DiscoveryWorker loop error — will retry")

    # ── Core discovery logic ─────────────────────────────────────────────────

    @classmethod
    async def _discover_all(cls, session: AsyncSession) -> None:
        """Iterate over all enabled endpoints and discover their models."""
        start = time.monotonic()
        ep_svc = ProviderEndpointService(session)
        endpoints = await ep_svc.list_endpoints()
        enabled = [e for e in endpoints if e.enabled]
        if not enabled:
            logger.debug("DiscoveryWorker: no enabled endpoints")
            return

        logger.info("DiscoveryWorker: discovering models on %d endpoints", len(enabled))
        for endpoint in enabled:
            try:
                # ponytail: per-endpoint savepoint so one failure doesn't
                # discard earlier endpoints' successful upserts.
                async with session.begin_nested():
                    await cls._discover_endpoint(session, endpoint)
            except Exception:
                logger.exception(
                    "DiscoveryWorker: failed for endpoint %s (%s)",
                    endpoint.id, endpoint.name,
                )
                # savepoint auto-rolled back; outer transaction continues

        elapsed = time.monotonic() - start
        logger.info("DiscoveryWorker: pass complete in %.1fs", elapsed)

    @classmethod
    async def _discover_endpoint(cls, session: AsyncSession, endpoint: ProviderEndpoint) -> None:
        """Discover models on one endpoint using one active credential."""
        cred_svc = CredentialService(session)
        credentials = await cred_svc.list_credentials(
            provider_endpoint_id=endpoint.id,
        )
        if not credentials:
            logger.debug("DiscoveryWorker: no credentials for endpoint %s", endpoint.id)
            return

        # Pick one active credential, or fall back to any enabled one.
        probe_cred = next(
            (c for c in credentials if c.enabled and c.runtime_status == "active"),
            None,
        )
        if probe_cred is None:
            probe_cred = next((c for c in credentials if c.enabled), None)
        if probe_cred is None:
            logger.debug(
                "DiscoveryWorker: no usable credential for endpoint %s", endpoint.id,
            )
            return

        secret = await cred_svc.get_secret_for_invocation(probe_cred.id)
        if not secret:
            logger.warning(
                "DiscoveryWorker: no secret for credential %s on endpoint %s",
                probe_cred.id, endpoint.id,
            )
            return

        adapter = get_adapter(endpoint.adapter_type)
        model_ids = await adapter.list_models(
            base_url=endpoint.base_url,
            secret=secret,
            default_headers=endpoint.default_headers,
        )

        if not model_ids:
            logger.debug(
                "DiscoveryWorker: no models returned for endpoint %s", endpoint.id,
            )
            return

        logger.info(
            "DiscoveryWorker: %d models on endpoint %s", len(model_ids), endpoint.id,
        )

        model_svc = UpstreamModelService(session)
        access_svc = CredentialModelAccessService(session)

        for model_id in model_ids:
            upstream = await model_svc.upsert_model(
                provider_endpoint_id=endpoint.id,
                upstream_model_id=model_id,
                discovery_source="probe",
            )
            # Record access for every credential on this endpoint.
            # ponytail: don't overwrite a manual "unavailable" status — only
            # set "available" when no prior status exists (None/"unknown").
            for cred in credentials:
                existing_rows = await access_svc.list_access(
                    credential_id=cred.id,
                    upstream_model_id=upstream.id,
                )
                existing = existing_rows[0] if existing_rows else None
                new_status = (
                    existing.status
                    if existing and existing.status not in ("unknown", None)
                    else "available"
                )
                await access_svc.upsert_access(
                    credential_id=cred.id,
                    upstream_model_id=upstream.id,
                    status=new_status,
                )

        # ponytail: discovery success doesn't imply completion health — don't
        # overwrite credential state. The ProbeWorker handles recovery
        # independently; GET /models may have different rate limits than
        # POST /chat/completions, so a 200 here says nothing about the latter.
        logger.debug(
            "DiscoveryWorker: credential %s used for discovery on endpoint %s",
            probe_cred.id, endpoint.id,
        )

        await session.flush()
