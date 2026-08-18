"""DiscoveryWorker — periodic background task that discovers upstream models.

Runs every ``interval_seconds`` (default 3600s), iterates over all enabled
:class:`ProviderEndpoint` rows, picks one active credential per endpoint,
calls ``adapter.list_models(...)``, and upserts :class:`UpstreamModel` +
:class:`CredentialModelAccess` rows for every model ID returned.

Network calls (``adapter.list_models``) happen OUTSIDE any DB session so
the single write connection is never held hostage during HTTP I/O.  Data
is loaded via a read session, probed outside, then batch-persisted in one
short write session — same pattern as ``KeyHealthWorker``.

Start/stop lifecycle mirrors ``KeyHealthWorker``::

    await DiscoveryWorker.start()
    await DiscoveryWorker.stop()
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import get_adapter
from stitch_backend.domains.ai_gateway.service import (
    CredentialModelAccessService,
    CredentialService,
    ProviderEndpointService,
    UpstreamModelService,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

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
                await cls._discover_all()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("DiscoveryWorker loop error — will retry")

    # ── Core discovery logic ─────────────────────────────────────────────────

    @classmethod
    async def _discover_all(cls) -> None:
        """Iterate over all enabled endpoints and discover their models.

        Three-phase flow (mirrors ``KeyHealthWorker``):
          1. READ session  — load endpoints + credentials + secrets, close.
          2. OUTSIDE session — call ``adapter.list_models()`` per endpoint.
          3. WRITE session — batch-persist all discoveries, close.
        """
        start = time.monotonic()

        # 1. Load endpoint + credential + secret data (read-only).
        probes = await cls._load_endpoints_for_discovery()
        if not probes:
            logger.debug("DiscoveryWorker: no enabled endpoints")
            return

        logger.info("DiscoveryWorker: discovering models on %d endpoints", len(probes))

        # 2. Probe each endpoint OUTSIDE any DB session (HTTP I/O).
        results: list[tuple[dict[str, Any], list[str]]] = []
        for probe in probes:
            try:
                model_ids = await cls._discover_models(probe)
                if model_ids:
                    results.append((probe, model_ids))
                else:
                    logger.debug(
                        "DiscoveryWorker: no models returned for endpoint %s",
                        probe["endpoint_id"],
                    )
            except Exception:
                logger.exception(
                    "DiscoveryWorker: failed for endpoint %s (%s)",
                    probe["endpoint_id"], probe["endpoint_name"],
                )

        # 3. Batch-persist all discoveries in one short WRITE session.
        if results:
            try:
                await cls._persist_discoveries(results)
            except Exception:
                logger.exception("DiscoveryWorker: failed to batch persist results")

        elapsed = time.monotonic() - start
        logger.info("DiscoveryWorker: pass complete in %.1fs", elapsed)

    @classmethod
    async def _load_endpoints_for_discovery(cls) -> list[dict[str, Any]]:
        """Load enabled endpoints + one usable credential + secret per endpoint.

        Uses a READ session so the write pool is untouched.  All ORM data is
        extracted into plain dicts before the session closes.
        """
        async def _op(session: AsyncSession) -> list[dict[str, Any]]:
            ep_svc = ProviderEndpointService(session)
            endpoints = await ep_svc.list_endpoints()
            enabled = [e for e in endpoints if e.enabled]
            if not enabled:
                return []

            cred_svc = CredentialService(session)
            probes: list[dict[str, Any]] = []
            for endpoint in enabled:
                credentials = await cred_svc.list_credentials(
                    provider_endpoint_id=endpoint.id,
                )
                if not credentials:
                    logger.debug(
                        "DiscoveryWorker: no credentials for endpoint %s",
                        endpoint.id,
                    )
                    continue

                # Pick one active credential, or fall back to any enabled one.
                probe_cred = next(
                    (c for c in credentials if c.enabled and c.runtime_status == "active"),
                    None,
                )
                if probe_cred is None:
                    probe_cred = next((c for c in credentials if c.enabled), None)
                if probe_cred is None:
                    logger.debug(
                        "DiscoveryWorker: no usable credential for endpoint %s",
                        endpoint.id,
                    )
                    continue

                secret = await cred_svc.get_secret_for_invocation(probe_cred.id)
                if not secret:
                    logger.warning(
                        "DiscoveryWorker: no secret for credential %s on endpoint %s",
                        probe_cred.id, endpoint.id,
                    )
                    continue

                probes.append({
                    "endpoint_id": endpoint.id,
                    "endpoint_name": endpoint.name,
                    "adapter_type": endpoint.adapter_type,
                    "base_url": endpoint.base_url,
                    "default_headers": endpoint.default_headers,
                    "probe_cred_id": probe_cred.id,
                    "secret": secret,
                    "all_cred_ids": [c.id for c in credentials],
                })
            return probes

        return await run_in_read_session(_op)

    @classmethod
    async def _discover_models(cls, probe: dict[str, Any]) -> list[str]:
        """Call ``adapter.list_models()`` OUTSIDE any DB session (HTTP I/O)."""
        adapter = get_adapter(probe["adapter_type"])
        model_ids = await adapter.list_models(
            base_url=probe["base_url"],
            secret=probe["secret"],
            default_headers=probe["default_headers"],
        )

        if model_ids:
            logger.info(
                "DiscoveryWorker: %d models on endpoint %s",
                len(model_ids), probe["endpoint_id"],
            )

        return model_ids

    @classmethod
    async def _persist_discoveries(
        cls, results: list[tuple[dict[str, Any], list[str]]],
    ) -> None:
        """Persist all discovered models in a single short WRITE transaction."""
        async def _op(session: AsyncSession) -> None:
            model_svc = UpstreamModelService(session)
            access_svc = CredentialModelAccessService(session)

            for probe, model_ids in results:
                # ponytail: per-endpoint savepoint so one failure doesn't
                # discard earlier endpoints' successful upserts.
                try:
                    async with session.begin_nested():
                        for model_id in model_ids:
                            upstream = await model_svc.upsert_model(
                                provider_endpoint_id=probe["endpoint_id"],
                                upstream_model_id=model_id,
                                discovery_source="probe",
                            )
                            # Record access for every credential on this endpoint.
                            # ponytail: don't overwrite a manual "unavailable"
                            # status — only set "available" when no prior status
                            # exists (None/"unknown").
                            for cred_id in probe["all_cred_ids"]:
                                existing_rows = await access_svc.list_access(
                                    credential_id=cred_id,
                                    upstream_model_id=upstream.id,
                                )
                                existing = existing_rows[0] if existing_rows else None
                                new_status = (
                                    existing.status
                                    if existing and existing.status not in ("unknown", None)
                                    else "available"
                                )
                                await access_svc.upsert_access(
                                    credential_id=cred_id,
                                    upstream_model_id=upstream.id,
                                    status=new_status,
                                )

                        # ponytail: discovery success doesn't imply completion
                        # health — don't overwrite credential state. The
                        # ProbeWorker handles recovery independently; GET
                        # /models may have different rate limits than POST
                        # /chat/completions, so a 200 here says nothing about
                        # the latter.
                        logger.debug(
                            "DiscoveryWorker: credential %s used for discovery on endpoint %s",
                            probe["probe_cred_id"], probe["endpoint_id"],
                        )

                        await session.flush()
                except Exception:
                    logger.exception(
                        "DiscoveryWorker: failed for endpoint %s (%s)",
                        probe["endpoint_id"], probe["endpoint_name"],
                    )
                    # savepoint auto-rolled back; outer transaction continues

        await run_in_session(_op)
