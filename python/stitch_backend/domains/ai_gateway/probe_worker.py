"""ProbeWorker — periodic background task that probes credential health.

Runs every ``interval_seconds`` (default 300s), iterates over credentials in
non-active runtime states (``cooldown``, ``rate_limited``, ``quota_exhausted``,
``auth_failed``, ``degraded``), filters by ``next_retry_at <= now`` (or NULL),
probes each via ``adapter.probe_credential(...)``, and transitions the
credential via ``credential_state.transition_credential(...)``.

Network calls (``adapter.probe_credential``) happen OUTSIDE any DB session so
the single write connection is never held hostage during HTTP I/O.  Data is
loaded via a read session, probed outside, then batch-persisted in one short
write session — same pattern as ``KeyHealthWorker``.

Start/stop lifecycle mirrors ``KeyHealthWorker``::

    await ProbeWorker.start()
    await ProbeWorker.stop()
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

from sqlalchemy import or_, select

from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import (
    ClassifiedError,
    get_adapter,
)
from stitch_backend.domains.ai_gateway.models import (
    Credential,
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
                await cls._probe_all()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("ProbeWorker loop error — will retry")

    # ── Core probe logic ─────────────────────────────────────────────────────

    @classmethod
    async def _probe_all(cls) -> None:
        """Probe all credentials in non-active states that are due for retry.

        Three-phase flow (mirrors ``KeyHealthWorker``):
          1. READ session  — load credentials + endpoints + secrets, close.
          2. OUTSIDE session — call ``adapter.probe_credential()`` per cred.
          3. WRITE session — batch-transition all credentials, close.
        """
        start = time.monotonic()

        # 1. Load probe targets (read-only).
        targets = await cls._load_probe_targets()
        if not targets:
            logger.debug("ProbeWorker: no credentials to probe")
            return

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

        elapsed = time.monotonic() - start
        logger.info("ProbeWorker: pass complete in %.1fs", elapsed)

    @classmethod
    async def _load_probe_targets(cls) -> list[dict[str, Any]]:
        """Load credentials due for retry + their endpoint + secret (read-only).

        Uses a READ session so the write pool is untouched.  All ORM data is
        extracted into plain dicts before the session closes.
        """
        async def _op(session: AsyncSession) -> list[dict[str, Any]]:
            now = _utcnow()
            result = await session.execute(
                select(Credential).where(
                    Credential.runtime_status.in_(_PROBE_STATES),
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

                secret = await cred_svc.get_secret_for_invocation(cred.id)
                if not secret:
                    logger.warning(
                        "ProbeWorker: no secret for credential %s", cred.id,
                    )
                    continue

                targets.append({
                    "credential_id": cred.id,
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
                "success": True,
                "http_status": probe.http_status,
                "classified": None,
            }

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
            classified = ClassifiedError(
                category="transport_error", is_endpoint_wide=True,
            )

        return {
            "credential_id": target["credential_id"],
            "success": False,
            "http_status": probe.http_status,
            "classified": classified,
        }

    @classmethod
    async def _persist_probe_results(cls, results: list[dict[str, Any]]) -> None:
        """Transition all probed credentials in one short WRITE transaction."""
        from stitch_backend.domains.ai_gateway import credential_state

        async def _op(session: AsyncSession) -> None:
            for result in results:
                # ponytail: per-credential savepoint so one failure doesn't
                # discard earlier credentials' successful transitions.
                try:
                    async with session.begin_nested():
                        classified: ClassifiedError | None = result["classified"]
                        await credential_state.transition_credential(
                            session, result["credential_id"],
                            error=classified,
                            http_status=result["http_status"],
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
