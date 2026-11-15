"""DiscoveryWorker — periodic background task that discovers upstream models.

Runs every ``interval_seconds`` (default 3600s), iterates over all enabled
:class:`ProviderEndpoint` rows, calls ``adapter.list_models(...)`` once per
enabled credential, and reconciles :class:`UpstreamModel` +
:class:`CredentialModelAccess` rows per key.

Per-key contract: a model is reachable through a credential only when that
credential's own ``GET /v1/models`` returned it.  A key that stops returning a
model gets ``status="unavailable"`` for that model only; manual denials and
manual unavailability survive discovery.

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
from stitch_backend.domains.ai_gateway.model_catalog_service import (
    VERIFICATION_TTL,
    _as_utc,
)
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

RETIREMENT_TTL = VERIFICATION_TTL
MAX_NEW_MODELS_TO_VERIFY = 20
VERIFICATION_CONCURRENCY = 4
VERIFICATION_BUDGET_SECONDS = 30.0
VERIFICATION_MAX_TOKENS = 1
NOT_RETURNED_BY_UPSTREAM = "not_returned_by_upstream"


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
        """Discover models for every enabled endpoint, key by key.

        Three-phase flow:
          1. READ session  — load endpoints + credentials + secrets, close.
          2. OUTSIDE session — call ``adapter.list_models()`` per credential.
          3. WRITE session — batch-persist all discoveries, close.
        """
        start = time.monotonic()

        probes = await cls._load_endpoints_for_discovery()
        if not probes:
            logger.debug("DiscoveryWorker: no enabled endpoints")
            return

        logger.info("DiscoveryWorker: discovering models on %d endpoints", len(probes))

        results = await cls._probe_endpoints(probes)
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
        usable: list[dict[str, Any]] = []
        for cred in credentials:
            if not cred.enabled:
                continue
            secret = await cred_svc.resolve_invocation_secret(cred)
            if secret is None:
                logger.warning(
                    "DiscoveryWorker: no secret for credential %s on endpoint %s",
                    cred.id, endpoint.id,
                )
                continue
            usable.append({
                "credential_id": cred.id,
                "secret": secret,
                "runtime_status": cred.runtime_status,
            })
        if not usable:
            logger.debug(
                "DiscoveryWorker: no usable credential for endpoint %s",
                endpoint.id,
            )
            return []

        usable.sort(key=lambda c: 0 if c["runtime_status"] == "active" else 1)
        model_svc = UpstreamModelService(db)
        known = {m.upstream_model_id for m in await model_svc.list_models(endpoint.id)}
        probe = {
            "endpoint_id": endpoint.id,
            "endpoint_name": endpoint.name,
            "adapter_type": endpoint.adapter_type,
            "base_url": endpoint.base_url,
            "default_headers": endpoint.default_headers,
            "credentials": usable,
            "known_model_ids": known,
        }

        per_cred: list[tuple[dict[str, Any], list[ModelMetadata]]] = []
        for cred_info in usable:
            models = await cls._discover_models(probe, cred_info)
            per_cred.append((cred_info, models))

        verification = await cls._verify_new_models(probe, per_cred)
        changed = await cls._persist_results(
            db,
            [{"probe": probe, "credentials": per_cred, "verification": verification}],
        )
        if changed:
            await event_bus.emit("endpoint.models_changed", {"endpoint_ids": changed})

        ordered: list[str] = []
        for _cred, models in per_cred:
            for metadata in models:
                if metadata.id not in ordered:
                    ordered.append(metadata.id)
        return ordered

    @classmethod
    async def _load_endpoints_for_discovery(cls) -> list[dict[str, Any]]:
        """Load enabled endpoints + every usable credential + its secret.

        Uses a READ session so the write pool is untouched.  All ORM data is
        extracted into plain dicts before the session closes.
        """
        async def _op(session: AsyncSession) -> list[dict[str, Any]]:
            ep_svc = ProviderEndpointService(session)
            endpoints = [e for e in await ep_svc.list_all_endpoints() if e.enabled]
            if not endpoints:
                return []

            cred_svc = CredentialService(session)
            model_svc = UpstreamModelService(session)
            probes: list[dict[str, Any]] = []
            for endpoint in endpoints:
                credentials = await cred_svc.list_all_credentials(
                    provider_endpoint_id=endpoint.id,
                )
                usable: list[dict[str, Any]] = []
                for cred in credentials:
                    if not cred.enabled:
                        continue
                    secret = await cred_svc.resolve_invocation_secret(cred)
                    if secret is None:
                        logger.warning(
                            "DiscoveryWorker: no secret for credential %s on endpoint %s",
                            cred.id, endpoint.id,
                        )
                        continue
                    usable.append({
                        "credential_id": cred.id,
                        "secret": secret,
                        "runtime_status": cred.runtime_status,
                    })
                if not usable:
                    logger.debug(
                        "DiscoveryWorker: no usable credential for endpoint %s",
                        endpoint.id,
                    )
                    continue

                usable.sort(key=lambda c: 0 if c["runtime_status"] == "active" else 1)
                known = {
                    m.upstream_model_id
                    for m in await model_svc.list_models(endpoint.id)
                }
                probes.append({
                    "endpoint_id": endpoint.id,
                    "endpoint_name": endpoint.name,
                    "adapter_type": endpoint.adapter_type,
                    "base_url": endpoint.base_url,
                    "default_headers": endpoint.default_headers,
                    "credentials": usable,
                    "known_model_ids": known,
                })
            return probes

        return await run_in_read_session(_op)

    @classmethod
    async def _probe_endpoints(
        cls, probes: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Probe every credential of every endpoint OUTSIDE any DB session."""
        results: list[dict[str, Any]] = []
        for probe in probes:
            per_cred: list[tuple[dict[str, Any], list[ModelMetadata]]] = []
            for cred in probe["credentials"]:
                try:
                    models = await cls._discover_models(probe, cred)
                except Exception as _exc:
                    logger.warning(
                        "DiscoveryWorker: failed for endpoint %s (%s): %s",
                        probe["endpoint_id"],
                        probe["endpoint_name"],
                        _exc,
                    )
                    continue
                per_cred.append((cred, models))
            if not per_cred:
                continue
            verification = await cls._verify_new_models(probe, per_cred)
            results.append({
                "probe": probe,
                "credentials": per_cred,
                "verification": verification,
            })
        return results

    @classmethod
    async def _discover_models(
        cls, probe: dict[str, Any], cred: dict[str, Any],
    ) -> list[ModelMetadata]:
        """List models for one credential OUTSIDE any DB session (HTTP I/O)."""
        adapter = get_adapter(probe["adapter_type"])
        models = await adapter.list_models_detailed(
            base_url=probe["base_url"],
            secret=cred["secret"],
            default_headers=probe["default_headers"],
        )
        logger.info(
            "DiscoveryWorker: %d models on endpoint %s for credential %s",
            len(models), probe["endpoint_id"], cred["credential_id"],
        )
        return models

    @classmethod
    async def _verify_new_models(
        cls,
        probe: dict[str, Any],
        per_cred: list[tuple[dict[str, Any], list[ModelMetadata]]],
    ) -> dict[str, dict[str, Any]]:
        """Probe newly discovered models with one healthy credential.

        Returns a mapping ``model id -> probe row``.  A cycle with more than
        ``MAX_NEW_MODELS_TO_VERIFY`` new models is skipped: an upstream that
        suddenly returns hundreds of ids is not worth a full probe sweep.
        """
        returned = {m.id for _cred, models in per_cred for m in models}
        new_ids = sorted(returned - probe["known_model_ids"])
        if not new_ids:
            return {}
        if len(new_ids) > MAX_NEW_MODELS_TO_VERIFY:
            logger.warning(
                "DiscoveryWorker: skipping verification of %d new models on endpoint %s",
                len(new_ids), probe["endpoint_id"],
            )
            return {}

        cred = next(
            (c for c, _models in per_cred if c["runtime_status"] == "active"),
            per_cred[0][0],
        )
        try:
            from stitch_backend.domains.ai_gateway.commands.probe_models import (
                probe_models,
            )

            adapter = get_adapter(probe["adapter_type"])
            rows = await probe_models(
                adapter,
                base_url=probe["base_url"],
                secret=cred["secret"],
                default_headers=probe["default_headers"],
                models=new_ids,
                concurrency=VERIFICATION_CONCURRENCY,
                max_tokens=VERIFICATION_MAX_TOKENS,
                prompt=None,
                vision_models=None,
                include_multimodal=False,
                budget=VERIFICATION_BUDGET_SECONDS,
            )
        except Exception as _exc:
            logger.warning(
                "DiscoveryWorker: verification failed for endpoint %s: %s",
                probe["endpoint_id"], _exc,
            )
            return {}
        return {row["model"]: row for row in rows}

    @classmethod
    async def _persist_discoveries(cls, results: list[dict[str, Any]]) -> None:
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
        results: list[dict[str, Any]],
    ) -> list[str]:
        model_svc = UpstreamModelService(session)
        access_svc = CredentialModelAccessService(session)
        changed_endpoints: list[str] = []

        for item in results:
            probe = item["probe"]
            endpoint_id = probe["endpoint_id"]
            try:
                async with session.begin_nested():
                    existing = {
                        m.upstream_model_id: m
                        for m in await model_svc.list_models(endpoint_id)
                    }
                    before = {mid for mid, m in existing.items() if m.enabled}
                    now = _utcnow()
                    verification = item.get("verification") or {}

                    upstream_rows = dict(existing)
                    for _cred, models in item["credentials"]:
                        for metadata in models:
                            prior = existing.get(metadata.id)
                            upstream = await model_svc.upsert_model(
                                provider_endpoint_id=endpoint_id,
                                upstream_model_id=metadata.id,
                                discovery_source="probe",
                                capabilities=cls._merge_capabilities(
                                    prior.capabilities if prior else None,
                                    metadata.capabilities,
                                    verification.get(metadata.id),
                                ),
                            )
                            upstream.last_seen_at = now
                            upstream_rows[metadata.id] = upstream

                    for cred, models in item["credentials"]:
                        returned = {m.id for m in models}
                        for mid, upstream in upstream_rows.items():
                            await cls._reconcile_access(
                                access_svc,
                                cred["credential_id"],
                                upstream,
                                present=mid in returned,
                            )

                    for mid, upstream in upstream_rows.items():
                        if mid in {m.id for _c, models in item["credentials"] for m in models}:
                            continue
                        if upstream.selection_source != "auto":
                            continue
                        if upstream.last_seen_at is None:
                            continue
                        if _as_utc(upstream.last_seen_at) >= now - RETIREMENT_TTL:
                            continue
                        upstream.enabled = False

                    await session.flush()
                    after = {
                        m.upstream_model_id
                        for m in await model_svc.list_models(endpoint_id)
                        if m.enabled
                    }
                    if after != before:
                        changed_endpoints.append(endpoint_id)
            except Exception as _exc:
                logger.warning(
                    "DiscoveryWorker: failed for endpoint %s (%s): %s",
                    endpoint_id,
                    probe["endpoint_name"],
                    _exc,
                )

        try:
            await ModelIdentityService(session).auto_group()
        except Exception as _exc:
            logger.warning("DiscoveryWorker: auto-group failed: %s", _exc)

        try:
            await ModelIdentityService(session).promote_verified_models()
        except Exception as _exc:
            logger.warning("DiscoveryWorker: model promotion failed: %s", _exc)

        return changed_endpoints

    @classmethod
    async def _reconcile_access(
        cls,
        access_svc: CredentialModelAccessService,
        credential_id: str,
        upstream: Any,
        *,
        present: bool,
    ) -> None:
        """Reconcile one (credential, model) access row.

        ``denied`` is never overwritten, manual ``unavailable`` survives, and
        a model the key stopped returning becomes ``unavailable`` (soft).
        """
        rows = await access_svc.list_access(
            credential_id=credential_id,
            upstream_model_id=upstream.id,
        )
        existing = rows[0] if rows else None
        if existing is None:
            if present:
                await access_svc.upsert_access(
                    credential_id, upstream.id, status="available", last_error=None,
                )
            else:
                await access_svc.upsert_access(
                    credential_id,
                    upstream.id,
                    status="unavailable",
                    last_error=NOT_RETURNED_BY_UPSTREAM,
                )
            return
        if existing.status == "denied":
            return
        manual_unavailable = (
            existing.status == "unavailable"
            and existing.last_error != NOT_RETURNED_BY_UPSTREAM
        )
        if manual_unavailable:
            return
        if present:
            await access_svc.upsert_access(
                credential_id, upstream.id, status="available", last_error=None,
            )
            return
        await access_svc.upsert_access(
            credential_id,
            upstream.id,
            status="unavailable",
            last_error=NOT_RETURNED_BY_UPSTREAM,
        )

    @staticmethod
    def _merge_capabilities(
        prior: dict[str, Any] | None,
        metadata_caps: dict[str, Any] | None,
        verification_row: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """Merge provider metadata and probe outcome into the capability bag."""
        caps: dict[str, Any] = dict(prior or {})
        if metadata_caps:
            caps.update(metadata_caps)
            caps["source"] = "provider_metadata"
            caps["verified_at"] = _utcnow().isoformat()
        if verification_row is not None:
            caps["verification_status"] = (
                "working" if verification_row.get("ok") else "failed"
            )
            caps["verified_at"] = _utcnow().isoformat()
            latency = verification_row.get("latencyMs")
            if latency is not None:
                caps["probe_latency_ms"] = int(latency)
            reason = verification_row.get("reason")
            if reason and not verification_row.get("ok"):
                caps["verification_reason"] = reason
        return caps or None
