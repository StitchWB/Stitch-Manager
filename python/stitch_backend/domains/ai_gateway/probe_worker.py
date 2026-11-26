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
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import or_, select

from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import (
    ClassifiedError,
    get_adapter,
)
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialModelAccess,
    ProviderEndpoint,
    RoleChainEntry,
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

QUOTA_PROBE_INTERVAL_SECONDS = 600
_QUOTA_PROBE_CONCURRENCY = 4
_QUOTA_ADAPTER_TYPE = "openai_compatible"

# ── Exact-model role-target probes (spec §6C) ───────────────────────────────
# Recovery of quarantined/demoted role targets is probe-driven ONLY: there is
# no TTL resurrection.  Probes are rare, exact, budgeted and backed off — the
# upstream must never see a catalog-wide sweep or a fingerprintable ping.
ROLE_PROBE_MAX_PER_ENDPOINT_PER_PASS = 1
ROLE_PROBE_BUDGET_SECONDS = 8.0
ROLE_PROBE_BACKOFF_BASE_SECONDS = 300
ROLE_PROBE_BACKOFF_CAP_SECONDS = 3600
ROLE_PROBE_MAX_TOKENS = 8
# Deliberately NOT a trivially fingerprintable "ping".
ROLE_PROBE_PROMPT = "Briefly confirm you are operational in one short sentence."

# In-memory endpoint-level probe backoff, armed when the upstream detects and
# pushes back on catalog probing (``catalog_probe_detected``) or otherwise
# answers endpoint-scoped failure to an exact probe.  Blaming the model for
# that would be wrong; hammering the endpoint would be worse.
_role_probe_endpoint_backoff: dict[str, tuple[datetime, int]] = {}


def _reset_role_probe_backoff() -> None:
    """Clear in-memory endpoint probe backoff. Intended for tests."""
    _role_probe_endpoint_backoff.clear()


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

        # NOTE: there is deliberately no TTL-based resurrection of
        # ``temporarily_unavailable`` model marks.  Recovery happens only
        # through a successful exact (credential, upstream_model) probe in
        # ``_probe_role_model_candidates`` (or a manual operator probe).

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

        try:
            await cls._probe_role_model_candidates()
        except Exception:
            logger.exception("ProbeWorker: role model probe phase failed")

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
        """No-op transitional shim — TTL resurrection was removed.

        ``temporarily_unavailable`` access marks are runtime health evidence,
        not cache entries: time alone must never make a model routable again.
        The only recovery path is a successful exact ``(credential,
        upstream_model)`` probe (see :meth:`_probe_role_model_candidates`) or
        a manual operator probe.  Kept as a shim so embedders/tests calling
        the hook directly degrade gracefully instead of crashing.
        """
        return

    # ── Exact-model role-target probes ───────────────────────────────────────

    @classmethod
    async def _load_role_probe_candidates(cls) -> list[dict[str, Any]]:
        """Read phase: pick at most one exact (credential, model) pair per endpoint.

        Only role-catalog-managed targets in ``quarantined``/``demoted``
        lifecycle are eligible — never the whole catalog.  A pair is skipped
        when the credential is unusable, the access row is terminally
        ``denied``, or its probe backoff has not expired yet.
        """
        from stitch_backend.domains.ai_gateway.models import (
            RouteTarget,
            UpstreamModel,
        )
        from stitch_backend.domains.ai_gateway.role_catalog_service import (
            REFORMBOSS_ENDPOINT_SELECTOR,
        )

        async def _op(session: AsyncSession) -> list[dict[str, Any]]:
            now = _utcnow()
            rows = (
                await session.execute(
                    select(RouteTarget, UpstreamModel, ProviderEndpoint)
                    .join(UpstreamModel, UpstreamModel.id == RouteTarget.upstream_model_id)
                    .join(
                        ProviderEndpoint,
                        ProviderEndpoint.id == UpstreamModel.provider_endpoint_id,
                    )
                    .where(
                        RouteTarget.managed_by == "role_catalog",
                        RouteTarget.lifecycle_status.in_(("quarantined", "demoted")),
                        ProviderEndpoint.enabled.is_(True),
                    )
                    .order_by(RouteTarget.lifecycle_updated_at.asc())
                )
            ).all()
            if not rows:
                return []

            # Exact probes are the recovery path for catalog-rotation flaps, so
            # a disabled upstream is still probe-eligible while an ENABLED
            # desired chain entry references it.  Conversely, rows that are no
            # longer desired must not attract probes merely because their
            # materialized target history is still quarantined/demoted.
            desired_entries = (
                await session.execute(
                    select(
                        RoleChainEntry.public_model_id,
                        RoleChainEntry.upstream_model_key,
                    ).where(
                        RoleChainEntry.endpoint_selector == REFORMBOSS_ENDPOINT_SELECTOR,
                        RoleChainEntry.enabled.is_(True),
                    ),
                )
            ).all()
            desired_pairs = {(public_id, upstream_key) for public_id, upstream_key in desired_entries}

            # Deduplicate upstreams; a target pair appearing in several role
            # chains is one exact probe, not many.
            upstreams: dict[str, tuple[UpstreamModel, ProviderEndpoint]] = {}
            for target, upstream, endpoint in rows:
                if (target.public_model_id, upstream.upstream_model_id) not in desired_pairs:
                    continue
                if not upstream.enabled and not (upstream.capabilities or {}).get("retired_auto"):
                    # Disabled-by-automation rows remain probe-eligible as the
                    # catalog-rotation recovery path; manually disabled rows do
                    # not (and probe success must not re-enable them).
                    continue
                upstreams.setdefault(upstream.id, (upstream, endpoint))

            cred_svc = CredentialService(session)
            picked: list[dict[str, Any]] = []
            endpoints_picked: set[str] = set()
            for upstream, endpoint in upstreams.values():
                if endpoint.id in endpoints_picked:
                    continue  # MAX_PER_ENDPOINT_PER_PASS = 1
                if cls._endpoint_probe_backoff_active(endpoint.id, now):
                    continue
                # Never probe into a non-closed breaker: the exact probe is
                # model evidence, not endpoint recovery, and must not sneak
                # traffic past an open/half-open circuit.
                if (endpoint.circuit_state or "closed") != "closed":
                    continue
                credentials = await cred_svc.list_all_credentials(
                    provider_endpoint_id=endpoint.id,
                )
                chosen: dict[str, Any] | None = None
                for cred in credentials:
                    if not cred.enabled:
                        continue
                    if cred.runtime_status not in ("active", "unknown"):
                        continue
                    access = (
                        await session.execute(
                            select(CredentialModelAccess).where(
                                CredentialModelAccess.credential_id == cred.id,
                                CredentialModelAccess.upstream_model_id == upstream.id,
                            ),
                        )
                    ).scalar_one_or_none()
                    if access is not None:
                        if access.status == "denied":
                            continue  # terminal for automation
                        if access.next_probe_at is not None:
                            next_probe = access.next_probe_at
                            if next_probe.tzinfo is None:
                                next_probe = next_probe.replace(tzinfo=UTC)
                            if next_probe > now:
                                continue  # pair backoff not expired
                    secret = await cred_svc.resolve_invocation_secret(cred)
                    if secret is None:
                        continue
                    chosen = {
                        "credential_id": cred.id,
                        "endpoint_id": endpoint.id,
                        "adapter_type": endpoint.adapter_type,
                        "base_url": endpoint.base_url,
                        "default_headers": endpoint.default_headers,
                        "secret": secret,
                        "upstream_row_id": upstream.id,
                        "upstream_model_id": upstream.upstream_model_id,
                    }
                    break
                if chosen is None:
                    continue
                endpoints_picked.add(endpoint.id)
                picked.append(chosen)
            return picked

        return await run_in_read_session(_op)

    @staticmethod
    def _endpoint_probe_backoff_active(endpoint_id: str, now: datetime) -> bool:
        entry = _role_probe_endpoint_backoff.get(endpoint_id)
        if entry is None:
            return False
        until, _failures = entry
        return until > now

    @staticmethod
    def _arm_endpoint_probe_backoff(endpoint_id: str) -> None:
        now = _utcnow()
        _until, failures = _role_probe_endpoint_backoff.get(
            endpoint_id, (now, 0),
        )
        failures += 1
        exponent = min(max(0, failures - 1), 4)
        delay = min(
            ROLE_PROBE_BACKOFF_CAP_SECONDS,
            ROLE_PROBE_BACKOFF_BASE_SECONDS * (2**exponent),
        )
        _role_probe_endpoint_backoff[endpoint_id] = (
            now + timedelta(seconds=delay),
            failures,
        )

    @classmethod
    async def _probe_exact_model(cls, target: dict[str, Any]) -> dict[str, Any]:
        """Network phase (outside any DB session): one exact model probe.

        Success requires actual content — an HTTP 200 with an empty
        completion is the exact failure mode this probe exists to catch.
        A budget timeout is *slowness*, not death: it never produces
        model-scoped failure evidence.
        """
        adapter = get_adapter(target["adapter_type"])
        start = time.monotonic()
        result: dict[str, Any] = {
            "credential_id": target["credential_id"],
            "endpoint_id": target["endpoint_id"],
            "upstream_row_id": target["upstream_row_id"],
            "upstream_model_id": target["upstream_model_id"],
        }
        try:
            data = await asyncio.wait_for(
                adapter.invoke(
                    base_url=target["base_url"],
                    secret=target["secret"],
                    model=target["upstream_model_id"],
                    messages=[{"role": "user", "content": ROLE_PROBE_PROMPT}],
                    stream=False,
                    default_headers=target["default_headers"],
                    max_tokens=ROLE_PROBE_MAX_TOKENS,
                ),
                timeout=ROLE_PROBE_BUDGET_SECONDS,
            )
        except TimeoutError:
            result.update({
                "outcome": "timeout",
                "latency_ms": int((time.monotonic() - start) * 1000),
                "classified": None,
            })
            return result
        except Exception as exc:
            classified = adapter.classify_error(exc)
            result.update({
                "outcome": "error",
                "latency_ms": int((time.monotonic() - start) * 1000),
                "classified": classified,
            })
            return result

        latency_ms = int((time.monotonic() - start) * 1000)
        text = cls._extract_completion_text(data)
        if text:
            result.update({
                "outcome": "ok",
                "latency_ms": latency_ms,
                "classified": None,
            })
            return result
        # HTTP 200 but no usable content: the empty-completion failure mode.
        result.update({
            "outcome": "error",
            "latency_ms": latency_ms,
            "classified": ClassifiedError(
                category="server_error",
                is_endpoint_wide=False,
                is_model_specific=True,
                scope="key",
                error_code="empty_completion",
            ),
        })
        return result

    @staticmethod
    def _extract_completion_text(data: Any) -> str | None:
        if not isinstance(data, dict):
            return None
        choices = data.get("choices")
        if isinstance(choices, list) and choices and isinstance(choices[0], dict):
            message = choices[0].get("message")
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, str) and content.strip():
                    return content
                if message.get("tool_calls") or message.get("reasoning_content"):
                    return "<non-text-completion>"
        return None

    @classmethod
    async def _probe_role_model_candidates(cls) -> None:
        """Probe exact (credential, model) pairs for quarantined/demoted role targets.

        Three-phase discipline: read dicts in a read session → network calls
        outside any session → one short write session.  Success is the sole
        automatic activation path for role targets; model-scoped failure
        backs off the exact pair; endpoint-scoped pushback arms an
        endpoint-level probe backoff instead of blaming the model.
        """
        from stitch_backend.domains.ai_gateway.role_catalog_service import (
            RoleCatalogService,
        )

        targets = await cls._load_role_probe_candidates()
        if not targets:
            return

        results: list[dict[str, Any]] = []
        for target in targets:
            try:
                results.append(await cls._probe_exact_model(target))
            except Exception:
                logger.exception(
                    "ProbeWorker: exact model probe failed for %s on credential %s",
                    target["upstream_model_id"],
                    target["credential_id"],
                )
        if not results:
            return

        async def _write(session: AsyncSession) -> None:
            service = RoleCatalogService(session)
            for result in results:
                try:
                    async with session.begin_nested():
                        await cls._apply_exact_probe_result(session, service, result)
                        await session.flush()
                except Exception:
                    logger.exception(
                        "ProbeWorker: failed to persist exact probe for %s",
                        result["upstream_model_id"],
                    )

        await run_in_session(_write)

    @classmethod
    async def _apply_exact_probe_result(
        cls,
        session: AsyncSession,
        service: Any,
        result: dict[str, Any],
    ) -> None:
        """Write phase for one exact probe outcome (inside a savepoint)."""
        outcome = result["outcome"]
        classified: ClassifiedError | None = result["classified"]

        if outcome == "ok":
            await service.apply_model_probe_result(
                credential_id=result["credential_id"],
                upstream_model_id=result["upstream_model_id"],
                probe_row={
                    "ok": True,
                    "reason": "ok",
                    "latencyMs": result["latency_ms"],
                },
            )
            logger.info(
                "ProbeWorker: exact probe SUCCESS %s (credential=%s) — promotion path",
                result["upstream_model_id"],
                result["credential_id"][:8],
            )
            return

        if outcome == "timeout":
            # Slowness is not death: no access-row demotion, no blame — but
            # back the pair off so a consistently slow model is not re-probed
            # every pass.  (Latency-aware lifecycle is a later phase.)
            await cls._backoff_pair(session, result)
            return

        assert classified is not None
        scope = getattr(classified, "scope", None) or ""
        error_code = getattr(classified, "error_code", None) or ""
        if error_code == "catalog_probe_detected" or scope in ("endpoint", "global"):
            # The endpoint is pushing back on probing or is itself unhealthy:
            # back off probing this endpoint, never blame the model.
            cls._arm_endpoint_probe_backoff(result["endpoint_id"])
            logger.info(
                "ProbeWorker: endpoint-scoped probe outcome (%s) on %s — endpoint backoff",
                error_code or classified.category,
                result["endpoint_id"],
            )
            return
        if scope in ("key", "account") and not getattr(
            classified, "is_model_specific", False,
        ):
            # Key/account evidence is the credential state machine's business,
            # not the model's.  Nothing is written for the pair.
            return

        await service.apply_model_probe_result(
            credential_id=result["credential_id"],
            upstream_model_id=result["upstream_model_id"],
            probe_row={
                "ok": False,
                "reason": classified.category,
                "errorCode": error_code or None,
                "latencyMs": result["latency_ms"],
            },
        )

    @classmethod
    async def _backoff_pair(
        cls,
        session: AsyncSession,
        result: dict[str, Any],
    ) -> None:
        """Increment probe backoff for one exact pair without health blame."""
        now = _utcnow()
        access = (
            await session.execute(
                select(CredentialModelAccess).where(
                    CredentialModelAccess.credential_id == result["credential_id"],
                    CredentialModelAccess.upstream_model_id == result["upstream_row_id"],
                ),
            )
        ).scalar_one_or_none()
        if access is None:
            access = CredentialModelAccess(
                credential_id=result["credential_id"],
                upstream_model_id=result["upstream_row_id"],
                status="unknown",
                created_at=now,
            )
            session.add(access)
            await session.flush()
        failures = int(access.probe_failures or 0) + 1
        exponent = min(max(0, failures - 1), 4)
        backoff = min(
            ROLE_PROBE_BACKOFF_CAP_SECONDS,
            ROLE_PROBE_BACKOFF_BASE_SECONDS * (2**exponent),
        )
        access.probe_failures = failures
        access.next_probe_at = now + timedelta(seconds=int(backoff))
        access.updated_at = now
        await session.flush()

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
                category="transport_error", is_endpoint_wide=True, scope="endpoint",
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
                # Key-scoped probe failures are evidence about that key only:
                # they must not pollute the endpoint's rolling metrics.
                include_endpoint = (
                    result["success"]
                    or classified is None
                    or classified.is_endpoint_wide
                    or classified.scope in ("endpoint", "global")
                )
                credential_state.record_outcome(
                    credential_id=result["credential_id"],
                    endpoint_id=result["endpoint_id"],
                    ok=result["success"],
                    latency_ms=result["latency_ms"],
                    error_kind=credential_state.classify_error_kind(
                        classified, result["http_status"],
                    ),
                    include_endpoint=include_endpoint,
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
