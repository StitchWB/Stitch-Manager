"""ProbeWorker — periodic background task that probes credential health.

Runs every ``interval_seconds`` (default 300s), iterates over credentials in
non-active runtime states (``cooldown``, ``rate_limited``, ``quota_exhausted``,
``auth_failed``, ``degraded``), filters by ``next_retry_at <= now`` (or NULL),
probes each via ``adapter.probe_credential(...)``, and transitions the
credential via ``credential_state.transition_credential(...)``.

Network calls (``adapter.probe_credential``) happen OUTSIDE any DB session so
the single write connection is never held hostage during HTTP I/O.  Data is
loaded via a read session, probed outside, then batch-persisted in one short
write session.

Start/stop lifecycle::

    await ProbeWorker.start()
    await ProbeWorker.stop()
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import or_, select, update

from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import (
    ClassifiedError,
    get_adapter,
)
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialModelAccess,
    ProviderEndpoint,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialService,
    ProviderEndpointService,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

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

# у non-velly кред метку temporarily_unavailable не пересчитывает никто — это односторонняя дверь
_MODEL_MARK_TTL_SECONDS = 600
QUOTA_PROBE_INTERVAL_SECONDS = 600
_QUOTA_PROBE_CONCURRENCY = 4
_QUOTA_ADAPTER_TYPE = "openai_compatible"


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
        await cls._warmup()
        while True:
            try:
                await asyncio.sleep(cls._interval_seconds)
                await cls._probe_all()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("ProbeWorker loop error — will retry")

    @classmethod
    async def _warmup(cls) -> None:
        """Immediate probe pass on startup so the first client request has fresh metrics."""
        try:
            await cls._probe_all(include_active=True)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("ProbeWorker warmup error")

    # ── Core probe logic ─────────────────────────────────────────────────────

    @classmethod
    async def _probe_all(cls, *, include_active: bool = False) -> None:
        """Probe credentials due for retry; ``include_active`` also probes live ones (warmup).

        Three-phase flow:
          1. READ session  — load credentials + endpoints + secrets, close.
          2. OUTSIDE session — call ``adapter.probe_credential()`` per cred.
          3. WRITE session — batch-transition all credentials, close.
        """
        start = time.monotonic()

        await cls._expire_stale_model_marks()

        # 1. Load probe targets (read-only).
        targets = await cls._load_probe_targets(include_active=include_active)
        if targets:
            logger.info("ProbeWorker: probing %d credentials", len(targets))

            # 2. Probe each credential OUTSIDE any DB session (HTTP I/O).
            results: list[dict[str, Any]] = []
            for target in targets:
                try:
                    result = await cls._probe_target(target)
                    results.append(result)
                except Exception:
                    logger.exception(
                        "ProbeWorker: failed for credential %s",
                        target["credential_id"],
                    )

            # 3. Batch-transition all credentials in one short WRITE session.
            if results:
                try:
                    await cls._persist_probe_results(results)
                except Exception:
                    logger.exception("ProbeWorker: failed to batch persist results")
        else:
            logger.debug("ProbeWorker: no credentials to probe")

        await cls._probe_quota_all()

        elapsed = time.monotonic() - start
        logger.info("ProbeWorker: pass complete in %.1fs", elapsed)

    @classmethod
    async def _load_quota_targets(cls) -> list[dict[str, Any]]:
        """Load enabled OpenAI-compatible credentials whose quota data is stale."""
        async def _op(session: AsyncSession) -> list[dict[str, Any]]:
            now = _utcnow()
            cutoff = now - timedelta(seconds=QUOTA_PROBE_INTERVAL_SECONDS)
            result = await session.execute(
                select(Credential, ProviderEndpoint)
                .join(
                    ProviderEndpoint,
                    Credential.provider_endpoint_id == ProviderEndpoint.id,
                )
                .where(
                    Credential.enabled.is_(True),
                    ProviderEndpoint.enabled.is_(True),
                    ProviderEndpoint.adapter_type == _QUOTA_ADAPTER_TYPE,
                    or_(
                        Credential.remaining_checked_at.is_(None),
                        Credential.remaining_checked_at < cutoff,
                    ),
                ),
            )
            cred_svc = CredentialService(session)
            targets: list[dict[str, Any]] = []
            for cred, endpoint in result.all():
                secret = await cred_svc.resolve_invocation_secret(cred)
                if secret is None:
                    logger.warning(
                        "ProbeWorker: no secret for credential %s", cred.id,
                    )
                    continue
                targets.append({
                    "credential_id": cred.id,
                    "endpoint_id": endpoint.id,
                    "base_url": endpoint.base_url,
                    "default_headers": endpoint.default_headers,
                    "secret": secret,
                })
            return targets

        return await run_in_read_session(_op)

    @classmethod
    async def _probe_quota_all(cls) -> None:
        """Refresh free billing quota data without changing healthy-key state."""
        targets = await cls._load_quota_targets()
        if not targets:
            return

        by_endpoint: dict[str, list[dict[str, Any]]] = {}
        for target in targets:
            by_endpoint.setdefault(target["endpoint_id"], []).append(target)

        results: list[dict[str, Any]] = []
        for endpoint_targets in by_endpoint.values():
            semaphore = asyncio.Semaphore(_QUOTA_PROBE_CONCURRENCY)

            async def _probe(
                target: dict[str, Any],
                semaphore: asyncio.Semaphore = semaphore,
            ) -> None:
                async with semaphore:
                    try:
                        result = await cls._probe_quota_target(target)
                    except Exception:
                        logger.exception(
                            "ProbeWorker: quota probe failed for credential %s",
                            target["credential_id"],
                        )
                        return
                    results.append(result)

            await asyncio.gather(*(_probe(target) for target in endpoint_targets))

        if results:
            await cls._persist_quota_results(results)

    @classmethod
    async def _probe_quota_target(cls, target: dict[str, Any]) -> dict[str, Any]:
        adapter = get_adapter(_QUOTA_ADAPTER_TYPE)
        probe_quota = getattr(adapter, "probe_quota", None)
        if probe_quota is None:
            return {
                "credential_id": target["credential_id"],
                "endpoint_id": target["endpoint_id"],
                "ok": False,
                "http_status": 0,
                "remaining_usd": None,
                "suspended": False,
                "classified": None,
            }
        result = await probe_quota(
            base_url=target["base_url"],
            secret=target["secret"],
            default_headers=target["default_headers"],
        )
        return {
            "credential_id": target["credential_id"],
            "endpoint_id": target["endpoint_id"],
            "ok": result.ok,
            "http_status": result.http_status,
            "remaining_usd": result.remaining_usd,
            "suspended": result.suspended,
            "classified": result.classified,
        }

    @classmethod
    async def _persist_quota_results(cls, results: list[dict[str, Any]]) -> None:
        """Persist quota freshness and apply only suspension transitions."""
        from stitch_backend.domains.ai_gateway import credential_state

        async def _op(session: AsyncSession) -> None:
            for result in results:
                credential = await session.get(Credential, result["credential_id"])
                if credential is None:
                    continue
                credential.remaining_checked_at = _utcnow()
                if result["ok"]:
                    credential.remaining_usd = result["remaining_usd"]
                    await session.flush()
                    continue
                if result["suspended"]:
                    classified = result["classified"]
                    if classified is not None:
                        await credential_state.transition_credential(
                            session,
                            result["credential_id"],
                            error=classified,
                            http_status=result["http_status"],
                        )
                await session.flush()

        await run_in_session(_op)

    @classmethod
    async def _expire_stale_model_marks(cls) -> None:
        """Reset ``temporarily_unavailable`` access marks older than the TTL."""

        async def _op(session: AsyncSession) -> None:
            cutoff = _utcnow() - timedelta(seconds=_MODEL_MARK_TTL_SECONDS)
            result = await session.execute(
                update(CredentialModelAccess)
                .where(
                    CredentialModelAccess.status == "temporarily_unavailable",
                    CredentialModelAccess.last_verified_at < cutoff,
                )
                .values(status="available")
            )
            await session.flush()
            # Models became routable again — drop stale route resolutions.
            # Only when rows actually transitioned: a no-op sweep must not
            # churn the cache.
            transitioned = int(getattr(result, "rowcount", 0) or 0)
            if transitioned:
                from stitch_backend.core.event_bus import event_bus
                await event_bus.emit(
                    "credential.model_access_changed",
                    {"transitions": transitioned},
                )

        try:
            await run_in_session(_op)
        except Exception:
            logger.exception("ProbeWorker: failed to expire stale model marks")

    @classmethod
    async def _load_probe_targets(cls, *, include_active: bool = False) -> list[dict[str, Any]]:
        """Load credentials due for retry + their endpoint + secret (read-only).

        Uses a READ session so the write pool is untouched.  All ORM data is
        extracted into plain dicts before the session closes.
        """
        states = (*_PROBE_STATES, "active") if include_active else _PROBE_STATES

        async def _op(session: AsyncSession) -> list[dict[str, Any]]:
            now = _utcnow()
            result = await session.execute(
                select(Credential).where(
                    Credential.runtime_status.in_(states),
                    or_(Credential.next_retry_at.is_(None), Credential.next_retry_at <= now),
                ),
            )
            credentials = list(result.scalars().all())
            if not credentials:
                return []

            ep_svc = ProviderEndpointService(session)
            cred_svc = CredentialService(session)
            targets: list[dict[str, Any]] = []
            for cred in credentials:
                endpoint = await ep_svc.get_by_pk(cred.provider_endpoint_id)
                if endpoint is None:
                    logger.warning(
                        "ProbeWorker: endpoint %s not found for credential %s",
                        cred.provider_endpoint_id, cred.id,
                    )
                    continue

                secret = await cred_svc.resolve_invocation_secret(cred)
                if secret is None:
                    logger.warning(
                        "ProbeWorker: no secret for credential %s", cred.id,
                    )
                    continue

                targets.append({
                    "credential_id": cred.id,
                    "endpoint_id": endpoint.id,
                    "adapter_type": endpoint.adapter_type,
                    "base_url": endpoint.base_url,
                    "default_headers": endpoint.default_headers,
                    "secret": secret,
                })
            return targets

        return await run_in_read_session(_op)

    @classmethod
    async def _probe_target(cls, target: dict[str, Any]) -> dict[str, Any]:
        """Probe one credential OUTSIDE any DB session (HTTP I/O).

        Returns a result dict with ``credential_id``, ``success``,
        ``http_status``, and ``classified`` (ClassifiedError | None).
        """
        adapter = get_adapter(target["adapter_type"])
        probe = await adapter.probe_credential(
            base_url=target["base_url"],
            secret=target["secret"],
            default_headers=target["default_headers"],
        )

        if probe.success:
            return {
                "credential_id": target["credential_id"],
                "endpoint_id": target["endpoint_id"],
                "success": True,
                "http_status": probe.http_status,
                "latency_ms": probe.latency_ms,
                "classified": None,
            }

        # Build a ClassifiedError from the probe result using the adapter.
        # Pass http_status directly — avoids constructing fake httpx
        # Request/Response objects that couple to httpx internals.
        if probe.http_status is not None:
            classified = adapter.classify_error(
                RuntimeError(probe.error or f"HTTP {probe.http_status}"),
                http_status=probe.http_status,
                response_body=probe.error_body,
            )
        else:
            # Transport error (no HTTP status)
            classified = ClassifiedError(
                category="transport_error", is_endpoint_wide=True,
            )

        return {
            "credential_id": target["credential_id"],
            "endpoint_id": target["endpoint_id"],
            "success": False,
            "http_status": probe.http_status,
            "latency_ms": probe.latency_ms,
            "classified": classified,
        }

    @classmethod
    async def _persist_probe_results(cls, results: list[dict[str, Any]]) -> None:
        """Transition all probed credentials in one short WRITE transaction."""
        from stitch_backend.domains.ai_gateway import credential_state

        async def _op(session: AsyncSession) -> None:
            for result in results:
                classified: ClassifiedError | None = result["classified"]
                credential_state.record_outcome(
                    credential_id=result["credential_id"],
                    endpoint_id=result["endpoint_id"],
                    ok=result["success"],
                    latency_ms=result["latency_ms"],
                    error_kind=credential_state.classify_error_kind(
                        classified, result["http_status"],
                    ),
                )
                # ponytail: per-credential savepoint so one failure doesn't
                # discard earlier credentials' successful transitions.
                try:
                    async with session.begin_nested():
                        await credential_state.transition_credential(
                            session, result["credential_id"],
                            error=classified,
                            http_status=result["http_status"],
                            source="probe",
                        )

                        if result["success"]:
                            logger.info(
                                "ProbeWorker: credential %s recovered → active",
                                result["credential_id"],
                            )
                        else:
                            category = (
                                classified.category if classified else "unknown"
                            )
                            logger.info(
                                "ProbeWorker: credential %s still unhealthy (%s)",
                                result["credential_id"], category,
                            )

                        await session.flush()
                except Exception:
                    logger.exception(
                        "ProbeWorker: failed for credential %s",
                        result["credential_id"],
                    )
                    # savepoint auto-rolled back; outer transaction continues

        await run_in_session(_op)
