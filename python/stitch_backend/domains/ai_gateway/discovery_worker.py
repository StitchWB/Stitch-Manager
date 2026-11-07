"""DiscoveryWorker — periodic background task that discovers upstream models.

Runs every ``interval_seconds`` (default 3600s), iterates over all enabled
:class:`ProviderEndpoint` rows, picks one active credential per endpoint,
calls ``adapter.list_models(...)``, and upserts :class:`UpstreamModel` +
:class:`CredentialModelAccess` rows for every model ID returned.

Network calls (``adapter.list_models``) happen OUTSIDE any DB session so
the single write connection is never held hostage during HTTP I/O.  Data
is loaded via a read session, probed outside, then batch-persisted in one
short write session.

Start/stop lifecycle::

    await DiscoveryWorker.start()
    await DiscoveryWorker.stop()
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

from stitch_backend.core.event_bus import event_bus
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import ModelMetadata, get_adapter
from stitch_backend.domains.ai_gateway.models import _utcnow
from stitch_backend.domains.ai_gateway.service import (
    CredentialModelAccessService,
    CredentialService,
    ModelIdentityService,
    ProviderEndpointService,
    UpstreamModelService,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from stitch_backend.domains.ai_gateway.models import ProviderEndpoint

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
            except Exception as _exc:
                logger.warning("DiscoveryWorker loop error — will retry: %s", _exc)

    # ── Core discovery logic ─────────────────────────────────────────────────

    @classmethod
    async def _discover_all(cls) -> None:
        """Iterate over all enabled endpoints and discover their models.

        Three-phase flow:
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
        results: list[tuple[dict[str, Any], list[ModelMetadata]]] = []
        for probe in probes:
            try:
                models = await cls._discover_models(probe)
                if models:
                    results.append((probe, models))
                else:
                    logger.debug(
                        "DiscoveryWorker: no models returned for endpoint %s",
                        probe["endpoint_id"],
                    )
            except Exception as _exc:
                logger.warning(
                    "DiscoveryWorker: failed for endpoint %s (%s): %s",
                    probe["endpoint_id"],
                    probe["endpoint_name"],
                    _exc,
                )

        # 3. Batch-persist all discoveries in one short WRITE session.
        if results:
            try:
                await cls._persist_discoveries(results)
            except Exception as _exc:
                logger.warning("DiscoveryWorker: failed to batch persist results: %s", _exc)

        elapsed = time.monotonic() - start
        logger.info("DiscoveryWorker: pass complete in %.1fs", elapsed)

    @classmethod
    async def _discover_endpoint(cls, db: AsyncSession, endpoint: ProviderEndpoint) -> list[str]:
        """On-demand discovery for one endpoint via the caller's session.

        Used by the manual discover command: the request session already owns
        the single write connection, so reads and the persist MUST go through
        it — spawning ``run_in_session`` here deadlocks on the pool. The
        adapter HTTP call sits between the read and the persist, same as the
        background loop. Adapter errors propagate to the caller (the command
        surfaces them to the UI); a missing credential or secret yields ``[]``.
        """
        cred_svc = CredentialService(db)
        credentials = await cred_svc.list_all_credentials(
            provider_endpoint_id=endpoint.id,
        )
        probe_cred = cls._select_probe_credential(credentials)
        if probe_cred is None:
            logger.debug(
                "DiscoveryWorker: no usable credential for endpoint %s",
                endpoint.id,
            )
            return []
        secret = await cred_svc.resolve_invocation_secret(probe_cred)
        if secret is None:
            logger.warning(
                "DiscoveryWorker: no secret for credential %s on endpoint %s",
                probe_cred.id, endpoint.id,
            )
            return []
        probe = {
            "endpoint_id": endpoint.id,
            "endpoint_name": endpoint.name,
            "adapter_type": endpoint.adapter_type,
            "base_url": endpoint.base_url,
            "default_headers": endpoint.default_headers,
            "probe_cred_id": probe_cred.id,
            "secret": secret,
            "all_cred_ids": [c.id for c in credentials],
        }
        models = await cls._discover_models(probe)
        if models:
            changed = await cls._persist_results(db, [(probe, models)])
            if changed:
                await event_bus.emit("endpoint.models_changed", {"endpoint_ids": changed})
        return [m.id for m in models]

    @staticmethod
    def _select_probe_credential(credentials: list[Any]) -> Any | None:
        probe_cred = next(
            (c for c in credentials if c.enabled and c.runtime_status == "active"),
            None,
        )
        if probe_cred is None:
            probe_cred = next((c for c in credentials if c.enabled), None)
        return probe_cred

    @classmethod
    async def _load_endpoints_for_discovery(cls) -> list[dict[str, Any]]:
        """Load enabled endpoints + one usable credential + secret per endpoint.

        Uses a READ session so the write pool is untouched.  All ORM data is
        extracted into plain dicts before the session closes.
        """
        async def _op(session: AsyncSession) -> list[dict[str, Any]]:
            ep_svc = ProviderEndpointService(session)
            endpoints = await ep_svc.list_all_endpoints()
            enabled = [e for e in endpoints if e.enabled]
            if not enabled:
                return []

            cred_svc = CredentialService(session)
            probes: list[dict[str, Any]] = []
            for endpoint in enabled:
                credentials = await cred_svc.list_all_credentials(
                    provider_endpoint_id=endpoint.id,
                )
                if not credentials:
                    logger.debug(
                        "DiscoveryWorker: no credentials for endpoint %s",
                        endpoint.id,
                    )
                    continue

                # Pick one active credential, or fall back to any enabled one.
                probe_cred = cls._select_probe_credential(credentials)
                if probe_cred is None:
                    logger.debug(
                        "DiscoveryWorker: no usable credential for endpoint %s",
                        endpoint.id,
                    )
                    continue

                secret = await cred_svc.resolve_invocation_secret(probe_cred)
                if secret is None:
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
    async def _discover_models(cls, probe: dict[str, Any]) -> list[ModelMetadata]:
        """List models OUTSIDE any DB session (HTTP I/O)."""
        adapter = get_adapter(probe["adapter_type"])
        models = await adapter.list_models_detailed(
            base_url=probe["base_url"],
            secret=probe["secret"],
            default_headers=probe["default_headers"],
        )

        if models:
            logger.info(
                "DiscoveryWorker: %d models on endpoint %s",
                len(models), probe["endpoint_id"],
            )

        return models

    @classmethod
    async def _persist_discoveries(
        cls, results: list[tuple[dict[str, Any], list[ModelMetadata]]],
    ) -> None:
        """Persist all discovered models in a single short WRITE transaction."""
        changed: list[str] = []

        async def _op(session: AsyncSession) -> None:
            changed.extend(await cls._persist_results(session, results))

        await run_in_session(_op)
        if changed:
            await event_bus.emit("endpoint.models_changed", {"endpoint_ids": changed})

    @classmethod
    async def _persist_results(
        cls,
        session: AsyncSession,
        results: list[tuple[dict[str, Any], list[ModelMetadata]]],
    ) -> list[str]:
        model_svc = UpstreamModelService(session)
        access_svc = CredentialModelAccessService(session)
        changed_endpoints: list[str] = []

        for probe, models in results:
            # ponytail: per-endpoint savepoint so one endpoint's failure doesn't discard earlier upserts.
            try:
                async with session.begin_nested():
                    for metadata in models:
                        upstream = await model_svc.upsert_model(
                            provider_endpoint_id=probe["endpoint_id"],
                            upstream_model_id=metadata.id,
                            discovery_source="probe",
                            capabilities=cls._capabilities_for_persist(metadata.capabilities),
                        )
                        # ponytail: never overwrite a manual "unavailable" status — only "unknown"/None becomes "available".
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

                    # ponytail: GET /models success says nothing about POST /chat/completions health — never touch credential state here.
                    logger.debug(
                        "DiscoveryWorker: credential %s used for discovery on endpoint %s",
                        probe["probe_cred_id"], probe["endpoint_id"],
                    )

                    await session.flush()
                changed_endpoints.append(probe["endpoint_id"])
            except Exception as _exc:
                logger.warning(
                    "DiscoveryWorker: failed for endpoint %s (%s): %s",
                    probe["endpoint_id"],
                    probe["endpoint_name"],
                    _exc,
                )
                # savepoint auto-rolled back; outer transaction continues

        try:
            await ModelIdentityService(session).auto_group()
        except Exception as _exc:
            logger.warning("DiscoveryWorker: auto-group failed: %s", _exc)

        return changed_endpoints

    @staticmethod
    def _capabilities_for_persist(capabilities: dict[str, Any]) -> dict[str, Any] | None:
        """Stamp provider capabilities with provenance; ``None`` when empty so manual caps survive."""
        if not capabilities:
            return None
        return {
            **capabilities,
            "source": "provider_metadata",
            "verified_at": _utcnow().isoformat(),
        }
