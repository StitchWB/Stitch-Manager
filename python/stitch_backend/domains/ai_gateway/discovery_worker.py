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
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import delete, select

from stitch_backend.core.event_bus import event_bus
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import ModelMetadata, get_adapter
from stitch_backend.domains.ai_gateway.model_catalog_service import (
    VERIFICATION_TTL,
    _as_utc,
)
from stitch_backend.domains.ai_gateway.models import (
    CredentialModelAccess,
    RouteTarget,
    UpstreamModel,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.pricing_cache import (
    PRICING_TTL_SECONDS,
    normalize_origin,
)
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
PRUNE_STALE_AFTER = timedelta(days=30)
PRUNE_INTERVAL_SECONDS = 86400
MAX_NEW_MODELS_TO_VERIFY = 20
VERIFICATION_CONCURRENCY = 4
VERIFICATION_BUDGET_SECONDS = 30.0
VERIFICATION_MAX_TOKENS = 1
NOT_RETURNED_BY_UPSTREAM = "not_returned_by_upstream"

REFORMBOSS_BASE_URL = "https://api.reformboss.com/v1"


def _normalize_base_url(url: Any) -> str:
    return (url or "").strip().lower().rstrip("/") if isinstance(url, str) else ""


def _catalog_verification_disabled(probe: dict[str, Any]) -> bool:
    """True when the catalog-wide verification sweep must be skipped.

    Two independent triggers: an explicit operator policy
    (``health_policy.probePolicy.catalogVerification == "off"``) or the
    ReformBoss default matcher (normalized base URL match).  Defensive on
    shape: malformed policy means the default (verification runs).
    """
    policy = probe.get("health_policy")
    if isinstance(policy, dict):
        probe_policy = policy.get("probePolicy")
        if isinstance(probe_policy, dict) and probe_policy.get("catalogVerification") == "off":
            return True
    return _normalize_base_url(probe.get("base_url")) == REFORMBOSS_BASE_URL

_ENDPOINT_CLASS_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("rerank", ("rerank",)),
    ("embed", ("embed",)),
    ("video", ("video", "sora")),
    ("image", ("image",)),
    ("audio", ("audio", "tts", "speech", "transcri")),
    ("3d", ("3d",)),
    ("vision", ("vision",)),
)

_ID_CLASS_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("rerank", ("rerank",)),
    ("embed", ("embed",)),
    ("video", ("sora", "video", "wan2", "wan-", "i2v", "t2v", "veo")),
    ("image", ("flux", "dall", "image", "sd3", "sdxl", "midjourney", "imagen")),
    ("audio", ("whisper", "tts", "audio", "speech", "asr")),
    ("3d", ("3d", "trellis")),
    ("vision", ("vision", "llava", "-vl", "vl-", "omni")),
)

_PRICING_CACHE: dict[str, tuple[float, dict[str, dict[str, Any]]]] = {}


def _derive_model_class(model_id: str, endpoint_types: list[str] | None = None) -> str:
    declared = " ".join(str(t).lower() for t in endpoint_types or ())
    for model_class, needles in _ENDPOINT_CLASS_HINTS:
        if any(needle in declared for needle in needles):
            return model_class
    lowered = model_id.lower()
    for model_class, needles in _ID_CLASS_HINTS:
        if any(needle in lowered for needle in needles):
            return model_class
    return "chat"


def _parse_pricing_table(payload: dict[str, Any] | None) -> dict[str, dict[str, Any]] | None:
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    if not isinstance(data, list):
        return None
    table: dict[str, dict[str, Any]] = {}
    for item in data:
        if not isinstance(item, dict):
            continue
        name = item.get("model_name")
        if isinstance(name, str) and name:
            table[name] = item
    return table


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _model_enrichment(
    model_id: str,
    pricing_row: dict[str, Any] | None,
    fallback_endpoint_types: list[str] | None = None,
) -> dict[str, Any]:
    row = pricing_row or {}
    declared = row.get("supported_endpoint_types")
    endpoint_types = declared if isinstance(declared, list) else fallback_endpoint_types
    enrichment: dict[str, Any] = {
        "model_class": _derive_model_class(model_id, endpoint_types),
    }
    vendor = row.get("vendor_id")
    if vendor is not None:
        enrichment["vendor"] = vendor
    quota_type = row.get("quota_type")
    if isinstance(quota_type, int | float) and not isinstance(quota_type, bool):
        enrichment["quota_type"] = int(quota_type)
    for key in ("model_ratio", "completion_ratio", "model_price"):
        if key not in row:
            continue
        parsed = _as_float(row[key])
        if parsed is not None:
            enrichment[key] = parsed
    groups = row.get("enable_groups")
    if isinstance(groups, list):
        enrichment["groups"] = [str(group) for group in groups]
    return enrichment


class DiscoveryWorker:
    """Periodic upstream-model discovery loop."""

    _task: asyncio.Task[None] | None = None
    _interval_seconds: int = 3600
    _last_prune_at: float = 0.0

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
                await cls._maybe_prune_stale()
            except asyncio.CancelledError:
                raise
            except Exception as _exc:
                logger.warning("DiscoveryWorker loop error — will retry: %s", _exc)

    @classmethod
    async def _maybe_prune_stale(cls) -> None:
        now = time.monotonic()
        if cls._last_prune_at and now - cls._last_prune_at < PRUNE_INTERVAL_SECONDS:
            return
        cls._last_prune_at = now
        await cls._prune_stale_models()

    @classmethod
    async def _prune_stale_models(cls) -> int:
        cutoff = _utcnow() - PRUNE_STALE_AFTER
        deleted = 0

        async def _op(session: AsyncSession) -> None:
            nonlocal deleted
            routed = (
                select(RouteTarget.id)
                .where(RouteTarget.upstream_model_id == UpstreamModel.id)
                .exists()
            )
            accessible = (
                select(CredentialModelAccess.id)
                .where(CredentialModelAccess.upstream_model_id == UpstreamModel.id)
                .exists()
            )
            stmt = select(UpstreamModel).where(
                UpstreamModel.enabled.is_(False),
                UpstreamModel.discovery_source == "probe",
                UpstreamModel.selection_source == "auto",
                UpstreamModel.last_seen_at.is_not(None),
                ~routed,
                ~accessible,
            )
            candidates = list((await session.execute(stmt)).scalars().all())
            ids = [
                model.id
                for model in candidates
                if model.last_seen_at is not None
                and _as_utc(model.last_seen_at) < cutoff
            ]
            if not ids:
                return
            await session.execute(delete(UpstreamModel).where(UpstreamModel.id.in_(ids)))
            await session.flush()
            deleted = len(ids)

        await run_in_session(_op)
        if deleted:
            logger.info("DiscoveryWorker: pruned %d stale upstream models", deleted)
        return deleted

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
            "health_policy": endpoint.health_policy,
            "credentials": usable,
            "known_model_ids": known,
        }

        per_cred: list[tuple[dict[str, Any], list[ModelMetadata]]] = []
        for cred_info in usable:
            models = await cls._discover_models(probe, cred_info)
            per_cred.append((cred_info, models))

        verification = await cls._verify_new_models(probe, per_cred)
        pricing = await cls._load_pricing(probe)
        changed = await cls._persist_results(
            db,
            [{
                "probe": probe,
                "credentials": per_cred,
                "verification": verification,
                "pricing": pricing,
            }],
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
                    "health_policy": endpoint.health_policy,
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
            pricing = await cls._load_pricing(probe)
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
                "pricing": pricing,
            })
        return results

    @classmethod
    async def _load_pricing(cls, probe: dict[str, Any]) -> dict[str, dict[str, Any]]:
        """Fetch ``/api/pricing`` once per origin, cached for ``PRICING_TTL_SECONDS``."""
        origin = normalize_origin(probe["base_url"])
        if not origin:
            return {}
        cached = _PRICING_CACHE.get(origin)
        now = time.monotonic()
        if cached is not None and now - cached[0] < PRICING_TTL_SECONDS:
            return cached[1]
        try:
            fetch = getattr(get_adapter(probe["adapter_type"]), "fetch_pricing", None)
            if fetch is None:
                return {}
            payload = await fetch(probe["base_url"], probe["default_headers"])
        except Exception as _exc:
            logger.debug(
                "DiscoveryWorker: pricing fetch failed for %s: %s", origin, _exc,
            )
            return {}
        table = _parse_pricing_table(payload)
        if table is None:
            return {}
        _PRICING_CACHE[origin] = (now, table)
        return table

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

        Catalog-wide verification is skipped entirely for endpoints whose
        ``health_policy.probePolicy.catalogVerification`` is ``"off"`` and
        for endpoints matching the ReformBoss default matcher — their
        catalog rotates too fast and carries too many models for a probe
        sweep; health there is passive-first with exact-model probes only.
        Discovery listing itself still runs; only the probe sweep is gated.
        """
        if _catalog_verification_disabled(probe):
            logger.info(
                "DiscoveryWorker: catalog verification disabled for endpoint %s — skipping probe sweep",
                probe["endpoint_id"],
            )
            return {}
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

        new_id_set = set(new_ids)
        from stitch_backend.domains.ai_gateway.commands.probe_models import probe_models

        adapter = get_adapter(probe["adapter_type"])
        verified: dict[str, dict[str, Any]] = {}
        for cred, models in per_cred:
            ids = [m.id for m in models if m.id in new_id_set]
            if not ids:
                continue
            try:
                rows = await probe_models(
                    adapter,
                    base_url=probe["base_url"],
                    secret=cred["secret"],
                    default_headers=probe["default_headers"],
                    models=ids,
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
                continue
            for row in rows:
                row["_credential_id"] = cred["credential_id"]
                verified[row["model"]] = row
        return verified

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
        access_status_changed = False

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
                    pricing = item.get("pricing") or {}

                    upstream_rows = dict(existing)
                    for _cred, models in item["credentials"]:
                        for metadata in models:
                            prior = existing.get(metadata.id)
                            enrichment = _model_enrichment(
                                metadata.id,
                                pricing.get(metadata.id),
                                (metadata.capabilities or {}).get("endpoint_types"),
                            )
                            upstream = await model_svc.upsert_model(
                                provider_endpoint_id=endpoint_id,
                                upstream_model_id=metadata.id,
                                discovery_source="probe",
                                capabilities=cls._merge_capabilities(
                                    prior.capabilities if prior else None,
                                    metadata.capabilities,
                                    verification.get(metadata.id),
                                    enrichment,
                                ),
                            )
                            upstream.last_seen_at = now
                            if not upstream.enabled and upstream.selection_source == "auto":
                                caps = dict(upstream.capabilities or {})
                                if caps.pop("retired_auto", None):
                                    upstream.enabled = True
                                    upstream.capabilities = caps
                            upstream_rows[metadata.id] = upstream

                    for cred, models in item["credentials"]:
                        returned = {m.id for m in models}
                        for mid, upstream in upstream_rows.items():
                            access_status_changed = (
                                await cls._reconcile_access(
                                    access_svc,
                                    cred["credential_id"],
                                    upstream,
                                    present=mid in returned,
                                )
                                or access_status_changed
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
                        caps = dict(upstream.capabilities or {})
                        caps["retired_auto"] = True
                        upstream.capabilities = caps

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

        # Role catalog reconciliation: an endpoint added (or first discovered)
        # after startup must still materialize its role targets without a
        # restart.  Best-effort — a reconcile failure must never break
        # discovery persistence.  Non-matching endpoints no-op inside the
        # service, so this stays cheap for ordinary providers.
        try:
            from stitch_backend.domains.ai_gateway.role_catalog_service import (
                RoleCatalogService,
            )

            ep_svc = ProviderEndpointService(session)
            role_service = RoleCatalogService(session)
            for endpoint_id in {item["probe"]["endpoint_id"] for item in results}:
                try:
                    endpoint = await ep_svc.get_by_pk(endpoint_id)
                    if endpoint is not None:
                        await role_service.reconcile_endpoint(endpoint)
                except Exception as _exc:
                    logger.warning(
                        "DiscoveryWorker: role catalog reconcile failed for %s: %s",
                        endpoint_id, _exc,
                    )
        except Exception as _exc:
            logger.warning("DiscoveryWorker: role catalog reconcile failed: %s", _exc)

        try:
            await ModelIdentityService(session).auto_group()
        except Exception as _exc:
            logger.warning("DiscoveryWorker: auto-group failed: %s", _exc)

        try:
            await ModelIdentityService(session).promote_verified_models()
        except Exception as _exc:
            logger.warning("DiscoveryWorker: model promotion failed: %s", _exc)

        if access_status_changed:
            # Access rows are authoritative routing input.  Catalog discovery
            # does not necessarily change the upstream-enabled set, so it must
            # invalidate cached route resolutions independently.
            from stitch_backend.domains.ai_gateway.routing_engine import (
                invalidate_resolve_caches,
            )
            invalidate_resolve_caches()

        return changed_endpoints

    @classmethod
    async def _reconcile_access(
        cls,
        access_svc: CredentialModelAccessService,
        credential_id: str,
        upstream: Any,
        *,
        present: bool,
    ) -> bool:
        """Reconcile one (credential, model) access row.

        ``denied`` is never overwritten and manual ``unavailable`` survives.
        A runtime ``temporarily_unavailable`` mark is *not* probe evidence:
        when the model reappears in the catalog the mark must survive until
        ProbeWorker/invocation evidence expires or clears it.  Catalog absence
        is a different state, however, so an absent model still reconciles to
        soft ``unavailable`` with ``not_returned_by_upstream``.

        Returns True only when the routing-visible status transitioned.
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
            return True
        if existing.status == "denied":
            return False
        manual_unavailable = (
            existing.status == "unavailable"
            and existing.last_error != NOT_RETURNED_BY_UPSTREAM
        )
        if manual_unavailable:
            return False
        if present:
            if existing.status == "temporarily_unavailable":
                return False
            if existing.status == "available" and existing.last_error is None:
                return False
            await access_svc.upsert_access(
                credential_id, upstream.id, status="available", last_error=None,
            )
            return existing.status != "available"
        new_status = "unavailable"
        transitioned = existing.status != new_status
        if not transitioned and existing.last_error == NOT_RETURNED_BY_UPSTREAM:
            return False
        await access_svc.upsert_access(
            credential_id,
            upstream.id,
            status=new_status,
            last_error=NOT_RETURNED_BY_UPSTREAM,
        )
        return transitioned

    @staticmethod
    def _merge_capabilities(
        prior: dict[str, Any] | None,
        metadata_caps: dict[str, Any] | None,
        verification_row: dict[str, Any] | None,
        enrichment: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Merge provider metadata, pricing enrichment and probe outcome into the capability bag."""
        caps: dict[str, Any] = dict(prior or {})
        if metadata_caps:
            caps.update(metadata_caps)
            caps["source"] = "provider_metadata"
            caps["metadata_refreshed_at"] = _utcnow().isoformat()
        if enrichment:
            caps.update(enrichment)
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
