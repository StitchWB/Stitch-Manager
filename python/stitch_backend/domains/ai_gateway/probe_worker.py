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
import random
import re
import time
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import or_, select

from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import (
    ClassifiedError,
    get_adapter,
)
from stitch_backend.domains.ai_gateway.chain_refill_policy import (
    CHAIN_PROBE_BURST_MAX_PER_ENDPOINT_PER_PASS,
    CHAIN_PROBE_BURST_WINDOW_SECONDS,
    CHAIN_PROBE_CANDIDATE_MAX_PER_ENDPOINT_PER_PASS,
    rotation_state_active,
)
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialModelAccess,
    ProviderEndpoint,
    RoleChainEntry,
    UpstreamModel,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialService,
    ProviderEndpointService,
)
from stitch_backend.domains.ai_gateway.usage_integrity import assess_usage_arithmetic

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


def _safe_log(level: int, message: str, *args: Any, **kwargs: Any) -> None:
    """Best-effort logging that can never break persistence/control flow."""
    try:
        logger.log(level, message, *args, **kwargs)
    except Exception:
        # Logging must be observational only.  Custom handlers, closed capture
        # streams, and legacy console encodings are not reasons to roll back a
        # database savepoint or abort a probe batch.
        pass

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
# Steady-state recovery probing stays deliberately scarce: one exact model per
# endpoint per pass.  Newly materialized, never-verified role targets get a
# small burst for roughly the first three passes (900s at the standard 300s
# cadence) because a fresh rb/* install otherwise needs about an hour to
# verify its catalog.  Even the burst is tiny in token terms (at most
# 5 probes/pass x 3 passes x ROLE_PROBE_MAX_TOKENS completion tokens, plus
# prompts) and remains endpoint-backoff aware; after the warm-up window
# automation decays to 1/pass.  The window starts either at process restart
# or at target materialization time, so an endpoint added after process
# startup still gets the same cold-start treatment without extending the
# burst for long-lived endpoints.
ROLE_PROBE_MAX_PER_ENDPOINT_PER_PASS = 1
# Cold starts and detected rotations share the centralized bounded burst
# policy.  Keep the historical probe-worker names as compatibility aliases;
# chain_refill_policy.py is the source of truth for budget values.
ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS = CHAIN_PROBE_BURST_MAX_PER_ENDPOINT_PER_PASS
ROLE_PROBE_COLD_START_WINDOW_SECONDS = CHAIN_PROBE_BURST_WINDOW_SECONDS
# Sibling coverage is lower priority than recovery but gets one additional
# exact pair per endpoint/pass.  This bounds the steady-state probe cost to at
# most two exact probes/endpoint/pass while making multi-key failover real.
ROLE_PROBE_SIBLING_MAX_PER_ENDPOINT_PER_PASS = 1
# Unknown-tier catalog models are information-gathering work, strictly lower
# priority than recovery and sibling coverage.  Steady state is a trickle;
# only a persisted, timestamped rotation event re-arms the bounded burst.
ROLE_PROBE_CANDIDATE_MAX_PER_ENDPOINT_PER_PASS = CHAIN_PROBE_CANDIDATE_MAX_PER_ENDPOINT_PER_PASS
ROLE_PROBE_ROTATION_CANDIDATE_MAX_PER_ENDPOINT_PER_PASS = (
    CHAIN_PROBE_BURST_MAX_PER_ENDPOINT_PER_PASS
)
# Candidate evidence probes are allowed to observe slow-but-coherent emergency
# tails.  Ordinary activation probes keep the tighter budget above.  In steady
# state only one lowest-priority candidate probe may wait this long; detected
# rotation may briefly re-arm the same bounded candidate burst policy.
ROLE_CANDIDATE_PROBE_BUDGET_SECONDS = 90.0
# Refreshed in ``start()`` so the cold-start window is process/worker-local
# (as required for restarts); endpoint addition is detected separately from
# target materialization time below.  Module import is only a fallback for
# direct ``_probe_all`` invocations in tests/tools.
_PROBE_WORKER_STARTED_AT = _utcnow()
ROLE_PROBE_BUDGET_SECONDS = 8.0
ROLE_PROBE_BACKOFF_BASE_SECONDS = 300
ROLE_PROBE_BACKOFF_CAP_SECONDS = 3600
# 64 tokens, not fewer: reasoning models burn tokens before the final answer
# and truncate with EMPTY content at tiny budgets (observed failure mode:
# finish_reason=length with empty content at max_tokens=10), which would
# false-positive a coherent model.  Cost stays bounded — probes are rare,
# exact and backed off, so the worst case is a handful of 64-token probes
# per endpoint per pass.
ROLE_PROBE_MAX_TOKENS = 64

# ── Canary coherence probing ─────────────────────────────────────────────
# HTTP 200 is not proof of life: some upstreams answer plausible-but-collapsed
# garbage text (or nothing) with a 200 status.  The probe therefore asks for
# one specific unobvious word and passes ONLY when the response content
# contains it.  The word rotates per probe from a small list so a mock
# upstream cannot hardcode a single echo.  Selection goes through
# ``_select_canary_word`` so tests can pin it.
ROLE_PROBE_CANARY_WORDS = (
    "cascade",
    "zephyr",
    "lattice",
    "tundra",
    "quartz",
    "willow",
    "ember",
    "harbor",
)


def _select_canary_word() -> str:
    """Pick the canary word for one exact probe (random rotation)."""
    return random.choice(ROLE_PROBE_CANARY_WORDS)


def _canary_probe_prompt(word: str) -> str:
    return f'Reply with exactly one word: "{word}". Do not add anything else.'


ROLE_PROBE_LEVEL2_PROMPT = (
    "Reply with the third word of: alpha beta gamma delta, repeated twice "
    "with no separator. Do not add anything else."
)
ROLE_PROBE_LEVEL2_EXPECTED = "gammagamma"
# Real instruction-following noise is mostly presentation, not semantic failure:
# models capitalize, quote, punctuate, insert whitespace, or spell a separator
# ("gamma and gamma").  Normalize that noise before looking for the expected
# token sequence.  The check remains content-sensitive: unrelated prose or the
# wrong word does not pass merely because it is non-empty.
_LEVEL2_SEPARATOR_WORDS = (
    "and",
    "then",
    "plus",
    "with",
    "comma",
    "hyphen",
    "dash",
    "underscore",
    "separator",
    "space",
)
_LEVEL2_SEPARATOR_RE = re.compile(
    r"\b(?:" + "|".join(_LEVEL2_SEPARATOR_WORDS) + r")\b",
    re.IGNORECASE,
)
_LEVEL2_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def _level2_response_passes(text: str) -> bool:
    """Return whether a level-2 answer carries ``gammagamma`` through noise."""
    without_separator_words = _LEVEL2_SEPARATOR_RE.sub("", text.lower())
    compact = _LEVEL2_NON_ALNUM_RE.sub("", without_separator_words)
    return ROLE_PROBE_LEVEL2_EXPECTED in compact


def _exception_http_status(exc: BaseException) -> int | None:
    """Best-effort HTTP status extraction without coupling to one exception type."""
    for value in (
        getattr(exc, "http_status", None),
        getattr(exc, "status_code", None),
        getattr(getattr(exc, "response", None), "status_code", None),
    ):
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None

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
        global _PROBE_WORKER_STARTED_AT
        if cls._task is not None:
            logger.warning("ProbeWorker already running")
            return
        cls._interval_seconds = interval_seconds
        _PROBE_WORKER_STARTED_AT = _utcnow()
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

        # Passive role-health reconciliation runs once per probe pass (startup
        # warmup + every 300s steady-state).  It is SQL-only and cheap, and this
        # cadence matches the credential recovery evidence it consumes: a key
        # recovered earlier in this pass can immediately repair a target whose
        # only problem was credential-wide capacity loss.  Running it before
        # exact probing also makes freshly demoted targets probe-eligible in
        # the same pass without adding network cost.
        try:
            await cls._reconcile_role_catalog_health()
        except Exception:
            logger.exception("ProbeWorker: role catalog health reconciliation failed")

        try:
            await cls._probe_role_model_candidates(
                cold_start_budget=ROLE_PROBE_COLD_START_MAX_PER_ENDPOINT_PER_PASS,
            )
        except Exception:
            logger.exception("ProbeWorker: role model probe phase failed")

        try:
            await cls._run_chain_refill()
        except Exception:
            logger.exception("ProbeWorker: chain refill phase failed")

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
    async def _run_chain_refill(cls) -> None:
        """Detect upstream rotation, then run deficit chain refill in one write session."""
        from stitch_backend.domains.ai_gateway.chain_refill_service import (
            ChainRefillService,
        )

        async def _op(session: AsyncSession) -> None:
            service = ChainRefillService(session)
            actions = await service.detect_and_apply_refill(
                probe_pass_seconds=cls._interval_seconds,
            )
            if actions:
                roles = {action["public_model_id"] for action in actions}
                logger.info(
                    "Chain refill: applied %d refill entries across %d roles (%s)",
                    len(actions),
                    len(roles),
                    ",".join(sorted(roles)),
                )
            else:
                await service.log_rescue_inactivity()

        await run_in_session(_op)

    @classmethod
    async def _reconcile_role_catalog_health(cls) -> None:
        """Run the passive role-target health sweep in one short write session."""
        from stitch_backend.domains.ai_gateway.role_catalog_service import (
            RoleCatalogService,
        )

        async def _op(session: AsyncSession) -> None:
            await RoleCatalogService(session).reconcile_health()

        await run_in_session(_op)

    @classmethod
    async def _load_role_probe_candidates(
        cls,
        *,
        recovery_budget: int = ROLE_PROBE_MAX_PER_ENDPOINT_PER_PASS,
        sibling_budget: int = ROLE_PROBE_SIBLING_MAX_PER_ENDPOINT_PER_PASS,
        cold_start_budget: int | None = None,
    ) -> list[dict[str, Any]]:
        """Read phase: pick exact (credential, model) pairs for one pass.

        Recovery work (``quarantined``/``demoted`` targets) has priority and is
        capped by ``recovery_budget`` per endpoint.  Once targets are active,
        lower-priority sibling coverage probes at most ``sibling_budget``
        additional unprobed/unknown ``(credential, upstream)`` pairs per
        endpoint; this is what turns multi-key routing capacity from theory
        into real failover inventory.  Terminal ``denied`` pairs, unusable
        credentials, backed-off pairs, non-closed endpoint breakers, and
        endpoint-level probe backoff are never eligible for either class.
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
                        RouteTarget.lifecycle_status.in_(("quarantined", "demoted", "active")),
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

            base_recovery_budget = recovery_budget
            cold_endpoints: set[str] = set()
            if cold_start_budget is not None:
                cold_cutoff = now - timedelta(seconds=ROLE_PROBE_COLD_START_WINDOW_SECONDS)
                if _PROBE_WORKER_STARTED_AT >= cold_cutoff:
                    base_recovery_budget = max(recovery_budget, cold_start_budget)
                for target, _upstream, endpoint in rows:
                    # Anchor endpoint addition to target materialization, not
                    # lifecycle update time.  A failed first probe changes the
                    # lifecycle reason/timestamp, but must not collapse the
                    # bounded cold-start window before the rest of that fresh
                    # endpoint's catalog had its chance; conversely repeated
                    # probe failures must not keep re-arming the burst forever.
                    created = target.created_at
                    if created is not None and created.tzinfo is None:
                        created = created.replace(tzinfo=UTC)
                    if created is not None and created >= cold_cutoff:
                        cold_endpoints.add(endpoint.id)

            # Deduplicate upstreams; a target pair appearing in several role
            # chains is one exact probe, not many.  Recovery and sibling classes
            # are separated because active-target coverage must never starve
            # quarantined/demoted recovery work.
            recovery_upstreams: dict[str, tuple[UpstreamModel, ProviderEndpoint]] = {}
            active_upstreams: dict[str, tuple[UpstreamModel, ProviderEndpoint]] = {}
            for target, upstream, endpoint in rows:
                if (target.public_model_id, upstream.upstream_model_id) not in desired_pairs:
                    continue
                if not upstream.enabled and not (upstream.capabilities or {}).get("retired_auto"):
                    # Disabled-by-automation rows remain probe-eligible as the
                    # catalog-rotation recovery path; manually disabled rows do
                    # not (and probe success must not re-enable them).
                    continue
                if target.lifecycle_status in ("quarantined", "demoted"):
                    recovery_upstreams.setdefault(upstream.id, (upstream, endpoint))
                elif target.lifecycle_status == "active":
                    active_upstreams.setdefault(upstream.id, (upstream, endpoint))

            cred_svc = CredentialService(session)
            credentials_cache: dict[str, list[Credential]] = {}

            async def _credentials_for(endpoint: ProviderEndpoint) -> list[Credential]:
                if endpoint.id not in credentials_cache:
                    credentials_cache[endpoint.id] = await cred_svc.list_all_credentials(
                        provider_endpoint_id=endpoint.id,
                    )
                return credentials_cache[endpoint.id]

            async def _access_for(
                credential_id: str,
                upstream_row_id: str,
            ) -> CredentialModelAccess | None:
                return (
                    await session.execute(
                        select(CredentialModelAccess).where(
                            CredentialModelAccess.credential_id == credential_id,
                            CredentialModelAccess.upstream_model_id == upstream_row_id,
                        ),
                    )
                ).scalar_one_or_none()

            def _pair_backoff_active(access: CredentialModelAccess | None) -> bool:
                if access is None or access.next_probe_at is None:
                    return False
                next_probe = access.next_probe_at
                if next_probe.tzinfo is None:
                    next_probe = next_probe.replace(tzinfo=UTC)
                return next_probe > now

            def _endpoint_blocked(endpoint: ProviderEndpoint) -> bool:
                if cls._endpoint_probe_backoff_active(endpoint.id, now):
                    return True
                # Never probe into a non-closed breaker: the exact probe is
                # model evidence, not endpoint recovery, and must not sneak
                # traffic past an open/half-open circuit.
                return (endpoint.circuit_state or "closed") != "closed"

            async def _candidate_for(
                cred: Credential,
                endpoint: ProviderEndpoint,
                upstream: UpstreamModel,
            ) -> dict[str, Any] | None:
                secret = await cred_svc.resolve_invocation_secret(cred)
                if secret is None:
                    return None
                return {
                    "credential_id": cred.id,
                    "endpoint_id": endpoint.id,
                    "adapter_type": endpoint.adapter_type,
                    "base_url": endpoint.base_url,
                    "default_headers": endpoint.default_headers,
                    "secret": secret,
                    "upstream_row_id": upstream.id,
                    "upstream_model_id": upstream.upstream_model_id,
                }

            async def _choose_pair(
                endpoint: ProviderEndpoint,
                upstream: UpstreamModel,
                *,
                sibling: bool,
            ) -> dict[str, Any] | None:
                fallback: dict[str, Any] | None = None
                for cred in await _credentials_for(endpoint):
                    if not cred.enabled:
                        continue
                    if cred.runtime_status not in ("active", "unknown"):
                        continue
                    access = await _access_for(cred.id, upstream.id)
                    if access is not None and access.status == "denied":
                        continue  # terminal for automation
                    if _pair_backoff_active(access):
                        continue  # pair backoff not expired
                    if sibling and access is not None and access.status != "unknown":
                        # Coverage probing is only for pairs with no evidence
                        # yet (no row) or explicit unknown state.
                        continue
                    candidate = await _candidate_for(cred, endpoint, upstream)
                    if candidate is None:
                        continue
                    if sibling or access is None or access.status == "unknown":
                        return candidate
                    # Recovery preserves legacy behavior as fallback: when no
                    # never-probed pair exists, re-probe the first due pair
                    # (including an available row) because exact success is the
                    # activation authority for quarantined/demoted targets.
                    if fallback is None:
                        fallback = candidate
                return None if sibling else fallback

            picked: list[dict[str, Any]] = []
            probed_upstreams: set[str] = set()
            recovery_counts: dict[str, int] = {}
            for upstream, endpoint in recovery_upstreams.values():
                endpoint_recovery_budget = base_recovery_budget
                if endpoint.id in cold_endpoints:
                    endpoint_recovery_budget = max(recovery_budget, cold_start_budget or recovery_budget)
                if recovery_counts.get(endpoint.id, 0) >= endpoint_recovery_budget:
                    continue
                if _endpoint_blocked(endpoint):
                    continue
                chosen = await _choose_pair(endpoint, upstream, sibling=False)
                if chosen is None:
                    continue
                chosen["probe_kind"] = "recovery"
                recovery_counts[endpoint.id] = recovery_counts.get(endpoint.id, 0) + 1
                probed_upstreams.add(upstream.id)
                picked.append(chosen)

            sibling_counts: dict[str, int] = {}
            for upstream, endpoint in active_upstreams.values():
                if upstream.id in probed_upstreams:
                    continue  # never probe the same model twice in one pass
                if sibling_counts.get(endpoint.id, 0) >= sibling_budget:
                    continue
                if _endpoint_blocked(endpoint):
                    continue
                chosen = await _choose_pair(endpoint, upstream, sibling=True)
                if chosen is None:
                    continue
                chosen["probe_kind"] = "sibling_coverage"
                sibling_counts[endpoint.id] = sibling_counts.get(endpoint.id, 0) + 1
                probed_upstreams.add(upstream.id)
                picked.append(chosen)

            # Lowest-priority evidence trickle: at most one never-probed,
            # unknown-tier catalog model per endpoint/pass.  Name hints order
            # this queue only; they never admit a model to a chain or tier.
            desired_key_rows = (
                await session.execute(
                    select(RoleChainEntry.upstream_model_key).where(
                        RoleChainEntry.endpoint_selector == REFORMBOSS_ENDPOINT_SELECTOR,
                    ),
                )
            ).all()
            desired_keys = {row[0] for row in desired_key_rows}
            endpoint_ids = {endpoint.id for _target, _upstream, endpoint in rows}
            catalog_rows: list[tuple[UpstreamModel, ProviderEndpoint]] = []
            if endpoint_ids:
                raw_catalog_rows = (
                    await session.execute(
                        select(UpstreamModel, ProviderEndpoint)
                        .join(
                            ProviderEndpoint,
                            ProviderEndpoint.id == UpstreamModel.provider_endpoint_id,
                        )
                        .where(
                            UpstreamModel.provider_endpoint_id.in_(endpoint_ids),
                            UpstreamModel.enabled.is_(True),
                            ProviderEndpoint.enabled.is_(True),
                        )
                        .order_by(UpstreamModel.created_at.asc(), UpstreamModel.id.asc()),
                    )
                ).all()
                catalog_rows = [
                    (upstream, endpoint) for upstream, endpoint in raw_catalog_rows
                ]

            def _name_queue_prior(model_id: str) -> int:
                lowered = model_id.lower()
                if any(token in lowered for token in ("pro", "max", "high", "ultra")):
                    return 0
                if any(token in lowered for token in ("flash", "fast", "mini", "lite")):
                    return 2
                return 1

            def _unknown_evidence_tier(upstream: UpstreamModel) -> bool:
                caps = upstream.capabilities or {}
                return (
                    "probed_at" not in caps
                    and "coherence_passed" not in caps
                    and "evidence_tier" not in caps
                )

            candidate_rows = sorted(
                (
                    (upstream, endpoint)
                    for upstream, endpoint in catalog_rows
                    if upstream.id not in probed_upstreams
                    and upstream.upstream_model_id not in desired_keys
                    and _unknown_evidence_tier(upstream)
                ),
                key=lambda item: (_name_queue_prior(item[0].upstream_model_id), item[0].upstream_model_id),
            )
            candidate_counts: dict[str, int] = {}
            for upstream, endpoint in candidate_rows:
                candidate_budget = ROLE_PROBE_CANDIDATE_MAX_PER_ENDPOINT_PER_PASS
                if rotation_state_active(endpoint.health_policy, now):
                    candidate_budget = max(
                        candidate_budget,
                        ROLE_PROBE_ROTATION_CANDIDATE_MAX_PER_ENDPOINT_PER_PASS,
                    )
                if candidate_counts.get(endpoint.id, 0) >= candidate_budget:
                    continue
                # Endpoint pushback/backoff is a hard cap even in rotation
                # aggressive mode: re-armed burst size never overrides it.
                if _endpoint_blocked(endpoint):
                    continue
                # Catalog presence may already have marked the pair available;
                # unlike sibling coverage, candidate evidence probing is still
                # needed because catalog presence is not coherence evidence.
                chosen = await _choose_pair(endpoint, upstream, sibling=False)
                if chosen is None:
                    continue
                chosen["probe_kind"] = "candidate_evidence"
                chosen["evidence_probe"] = True
                candidate_counts[endpoint.id] = candidate_counts.get(endpoint.id, 0) + 1
                probed_upstreams.add(upstream.id)
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

        Success requires coherent content: the probe asks for one specific
        canary word and passes ONLY when the response content contains it.
        Candidate-evidence probes add the cheap level-2 instruction-following
        canary and use a longer observation budget so slow-but-coherent
        emergency tails become evidence instead of invisible timeouts.
        A budget timeout is *slowness*, not death: it never produces
        model-scoped failure evidence.
        """
        adapter = get_adapter(target["adapter_type"])
        start = time.monotonic()
        canary_word = _select_canary_word()
        evidence_probe = bool(target.get("evidence_probe"))
        budget = (
            ROLE_CANDIDATE_PROBE_BUDGET_SECONDS
            if evidence_probe
            else ROLE_PROBE_BUDGET_SECONDS
        )
        result: dict[str, Any] = {
            "credential_id": target["credential_id"],
            "endpoint_id": target["endpoint_id"],
            "upstream_row_id": target["upstream_row_id"],
            "upstream_model_id": target["upstream_model_id"],
            "usage_sane": None,
            "usage_reason": None,
            "level2_passed": None,
            "evidence_probe": evidence_probe,
            "http_status": None,
        }

        async def _invoke(prompt: str, timeout: float) -> Any:
            return await asyncio.wait_for(
                adapter.invoke(
                    base_url=target["base_url"],
                    secret=target["secret"],
                    model=target["upstream_model_id"],
                    messages=[{"role": "user", "content": prompt}],
                    stream=False,
                    default_headers=target["default_headers"],
                    max_tokens=ROLE_PROBE_MAX_TOKENS,
                ),
                timeout=timeout,
            )

        def _usage_evidence(data: Any, prompt: str) -> tuple[bool | None, str | None]:
            if not isinstance(data, dict):
                return None, None
            # The probe prompt is known to be a multi-token instruction even
            # when its character count falls below the live-traffic heuristic
            # threshold, so candidate probes evaluate it as substantial.
            sane, reason, _detail = assess_usage_arithmetic(
                data.get("usage"),
                request_text_chars=max(len(prompt), 120),
            )
            return sane, reason

        level1_prompt = _canary_probe_prompt(canary_word)
        try:
            data = await _invoke(level1_prompt, budget)
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
                "http_status": _exception_http_status(exc),
            })
            return result

        latency_ms = int((time.monotonic() - start) * 1000)
        usage_sane, usage_reason = _usage_evidence(data, level1_prompt)
        result["usage_sane"] = usage_sane
        result["usage_reason"] = usage_reason
        text = cls._extract_completion_text(data)
        if (
            text
            and text != "<non-text-completion>"
            and canary_word.lower() in text.lower()
        ):
            level2_passed: bool | None = None
            level2_endpoint_classified: ClassifiedError | None = None
            if evidence_probe:
                level2_passed = False
                remaining = max(1.0, budget - (time.monotonic() - start))
                try:
                    level2_data = await _invoke(ROLE_PROBE_LEVEL2_PROMPT, remaining)
                except Exception as exc:
                    # Level-2 failure/timeout is tier evidence only.  The
                    # level-1 canary already proved baseline coherence, and a
                    # key/model error here must not turn into model death.
                    # Endpoint-scoped pushback still arms the hard endpoint
                    # backoff through the returned classified object.
                    classified = adapter.classify_error(exc)
                    scope = getattr(classified, "scope", None) or ""
                    error_code = getattr(classified, "error_code", None) or ""
                    if error_code == "catalog_probe_detected" or scope in ("endpoint", "global"):
                        level2_endpoint_classified = classified
                    level2_data = None
                if level2_data is not None:
                    level2_text = cls._extract_completion_text(level2_data)
                    if isinstance(level2_text, str):
                        level2_passed = _level2_response_passes(level2_text)
                    level2_sane, level2_reason = _usage_evidence(
                        level2_data,
                        ROLE_PROBE_LEVEL2_PROMPT,
                    )
                    if level2_sane is False:
                        usage_sane = False
                        usage_reason = level2_reason or usage_reason
                result["level2_passed"] = level2_passed
                result["usage_sane"] = usage_sane
                result["usage_reason"] = usage_reason
            result.update({
                "outcome": "ok",
                "latency_ms": latency_ms,
                "classified": level2_endpoint_classified,
            })
            return result
        if text is None or text == "<non-text-completion>":
            # HTTP 200 but no usable content: the empty-completion failure
            # mode.  A reasoning/tool-only frame carries no verifiable answer
            # either — for a one-word prompt that is empty content, truncated
            # or degenerate, never proof of life.
            error_code = "empty_completion"
        else:
            # HTTP 200 with plausible text that does NOT carry the requested
            # canary word: the upstream is not actually performing the asked
            # inference (collapsed/mock/garbage completion).  Same
            # model-scoped failure evidence as an empty completion, distinct
            # code for observability.
            error_code = "canary_mismatch"
        result.update({
            "outcome": "error",
            "latency_ms": latency_ms,
            "classified": ClassifiedError(
                category="server_error",
                is_endpoint_wide=False,
                is_model_specific=True,
                scope="key",
                error_code=error_code,
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
    async def _probe_role_model_candidates(
        cls,
        *,
        recovery_budget: int = ROLE_PROBE_MAX_PER_ENDPOINT_PER_PASS,
        cold_start_budget: int | None = None,
    ) -> None:
        """Probe exact (credential, model) pairs for role-target health.

        Three-phase discipline: read dicts in a read session → network calls
        outside any session → one short write session.  Success is the sole
        automatic activation path for role targets; model-scoped failure
        backs off the exact pair; endpoint-scoped pushback arms an
        endpoint-level probe backoff instead of blaming the model.
        """
        from stitch_backend.domains.ai_gateway.role_catalog_service import (
            RoleCatalogService,
        )

        targets = await cls._load_role_probe_candidates(
            recovery_budget=recovery_budget,
            cold_start_budget=cold_start_budget,
        )
        if not targets:
            return

        results: list[dict[str, Any]] = []
        for target in targets:
            # Candidates were selected before any network evidence from this
            # pass.  Because probes run sequentially, re-check the endpoint
            # backoff immediately before each call: a catalog_probe_detected
            # result must stop not only future passes but also the remaining
            # cold-start burst for that endpoint.
            if cls._endpoint_probe_backoff_active(target["endpoint_id"], _utcnow()):
                continue
            try:
                result = await cls._probe_exact_model(target)
                results.append(result)
                classified = result.get("classified")
                scope = getattr(classified, "scope", None) or ""
                error_code = getattr(classified, "error_code", None) or ""
                endpoint_wide = bool(getattr(classified, "is_endpoint_wide", False)) and not getattr(
                    classified, "is_model_specific", False,
                )
                if (
                    error_code == "catalog_probe_detected"
                    or scope in ("endpoint", "global")
                    or endpoint_wide
                ):
                    cls._arm_endpoint_probe_backoff(target["endpoint_id"])
                    result["endpoint_backoff_armed"] = True
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
                    "usageSane": result.get("usage_sane"),
                    "usageReason": result.get("usage_reason"),
                    "level2Passed": result.get("level2_passed"),
                },
            )
            if result.get("evidence_probe"):
                logger.info(
                    "ProbeWorker: exact probe SUCCESS %s (credential=%s) — evidence trickle, no route promotion",
                    result["upstream_model_id"],
                    result["credential_id"][:8],
                )
            else:
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
        endpoint_wide = bool(getattr(classified, "is_endpoint_wide", False)) and not getattr(
            classified, "is_model_specific", False,
        )
        if (
            error_code == "catalog_probe_detected"
            or scope in ("endpoint", "global")
            or endpoint_wide
        ):
            # The endpoint is pushing back on probing or is itself unhealthy:
            # back off probing this endpoint, never blame the model.  Usually
            # this was already armed in the network loop so later burst
            # candidates stop immediately; keep the write-path fallback for
            # manually constructed results/tests.
            if not result.get("endpoint_backoff_armed"):
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
                "httpStatus": result.get("http_status"),
                "latencyMs": result["latency_ms"],
                "usageSane": result.get("usage_sane"),
                "usageReason": result.get("usage_reason"),
                "level2Passed": result.get("level2_passed"),
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
        upstream = await session.get(UpstreamModel, result["upstream_row_id"])
        if upstream is not None:
            # A timeout is not negative coherence evidence, but the latency
            # observation itself is useful evidence: slow candidates remain
            # visible instead of disappearing into probe noise.
            caps = dict(upstream.capabilities or {})
            latency = result.get("latency_ms")
            if isinstance(latency, int) and not isinstance(latency, bool):
                caps["probe_latency_ms"] = latency
            caps["probe_timed_out"] = True
            caps["probed_at"] = now.astimezone(UTC).isoformat()
            upstream.capabilities = caps
            upstream.updated_at = now
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
                        await session.flush()

                    # Keep informational logging outside the savepoint.  A
                    # logging failure must not reach begin_nested().__aexit__
                    # and roll back an otherwise successful transition.
                    if result["success"]:
                        _safe_log(
                            logging.INFO,
                            "ProbeWorker: credential %s recovered → active",
                            result["credential_id"],
                        )
                    else:
                        category = classified.category if classified else "unknown"
                        _safe_log(
                            logging.INFO,
                            "ProbeWorker: credential %s still unhealthy (%s)",
                            result["credential_id"], category,
                        )
                except Exception:
                    _safe_log(
                        logging.ERROR,
                        "ProbeWorker: failed for credential %s",
                        result["credential_id"],
                        exc_info=True,
                    )
                    # savepoint auto-rolled back; outer transaction continues

        await run_in_session(_op)
