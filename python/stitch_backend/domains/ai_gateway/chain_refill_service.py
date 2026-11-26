"""Desired-chain refill writer and rotation detector for rb/* role models.

The service composes *desired state only*.  It appends ``source='auto'``
entries for evidence-backed catalog models when a role drops below the minimum
live-candidate floor.  Materialization and activation remain owned by
``RoleCatalogService`` and the exact-probe lifecycle respectively, so refill can
choose what to try but can never make a model serve directly.

Phase 3 adds two conservative accelerators on top of rescue-from-zero:
steady-state deficit refill (minimum two active+probing candidates) and
endpoint-scoped upstream-rotation detection.  Detection only records an
operator-visible event and re-arms a bounded candidate-evidence probe burst;
it never bypasses exact-probe activation or endpoint backoff.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from stitch_backend.domains.ai_gateway.chain_refill_policy import (
    CHAIN_REFILL_MAX_AUTO_ENTRIES_PER_ROLE,
    CHAIN_REFILL_MAX_ENTRIES_PER_PASS,
    CHAIN_REFILL_MIN_LIVE_CANDIDATES_PER_ROLE,
    CHAIN_REFILL_READD_STICKINESS_SECONDS,
    CHAIN_ROTATION_CATALOG_MIN_MISSING,
    CHAIN_ROTATION_CATALOG_MIN_NEW_MODELS,
    CHAIN_ROTATION_CATALOG_MISSING_FRACTION,
    CHAIN_ROTATION_CATALOG_PASS_SECONDS,
    CHAIN_ROTATION_CATALOG_PASSES,
    CHAIN_ROTATION_DEMOTED_FRACTION,
    CHAIN_ROTATION_MAX_EVENT_MODEL_KEYS,
    CHAIN_ROTATION_MESSAGE,
    CHAIN_ROTATION_MIN_DEMOTED_MODELS,
    CHAIN_ROTATION_MODEL_SCOPED_REASONS,
    CHAIN_ROTATION_STATE_KEY,
    CHAIN_ROTATION_WATCH_KEY,
    CHAIN_ROTATION_WINDOW_SECONDS,
    as_utc,
    infer_model_family,
    parse_iso_utc,
    role_prefers_family_diversity,
    rotation_state,
    rotation_state_active,
)
from stitch_backend.domains.ai_gateway.model_evidence import tier_rank
from stitch_backend.domains.ai_gateway.models import (
    ProviderEndpoint,
    PublicModel,
    RoleChainEntry,
    RouteTarget,
    UpstreamModel,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.role_catalog_service import (
    DEFAULT_ROLE_CHAIN_SPECS,
    REFORMBOSS_BASE_URL,
    REFORMBOSS_ENDPOINT_SELECTOR,
    RoleCatalogService,
    _normalized_base_url,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Backwards-compatible aliases for the Phase-2 public constants.  New policy
# values live in chain_refill_policy.py so refill, probe budgeting and routing
# status share one source of truth.
CHAIN_REFILL_RESCUE_ENTRIES_PER_PASS = CHAIN_REFILL_MAX_ENTRIES_PER_PASS

_ROLE_REQUIRED_TIER = {
    "rb/lead": 3,
    "rb/planner": 3,
    "rb/reviewer-correctness": 3,
    "rb/reviewer-adversarial": 3,
    "rb/researcher": 2,
    "rb/builder": 2,
    "rb/builder-fast": 1,
    "rb/verifier": 1,
    "rb/small": 1,
}


class ChainRefillService:
    """Compose deficit auto entries; no-commit discipline like sibling services."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def plan_rescue_refill(
        self,
        *,
        public_model_id: str | None = None,
        endpoint_selector: str = REFORMBOSS_ENDPOINT_SELECTOR,
    ) -> list[dict[str, Any]]:
        """Return deficit additions that would be written, without writing them.

        The Phase-2 method name is retained as the stable integration surface.
        Its semantics are now the Phase-3 deficit policy: refill starts when a
        role has fewer than two enabled entries in ``active`` or ``probing``
        state, adds only enough candidates to reach that floor, and remains
        bounded by the per-pass/per-role auto-entry budgets.
        """
        endpoint = await self._endpoint_for_selector(endpoint_selector)
        if endpoint is None or not endpoint.enabled:
            return []

        entry_rows = list(
            (
                await self._db.execute(
                    select(RoleChainEntry).where(
                        RoleChainEntry.endpoint_selector == endpoint_selector,
                    ),
                )
            ).scalars().all(),
        )
        if not entry_rows:
            return []
        entries_by_role: dict[str, list[RoleChainEntry]] = {}
        for entry in entry_rows:
            if public_model_id is not None and entry.public_model_id != public_model_id:
                continue
            entries_by_role.setdefault(entry.public_model_id, []).append(entry)
        if not entries_by_role:
            return []

        statuses = {
            row["id"]: row
            for row in await RoleCatalogService(self._db).role_routing_status()
        }
        public_ids = list(entries_by_role)
        public_rows = list(
            (
                await self._db.execute(select(PublicModel).where(PublicModel.id.in_(public_ids)))
            ).scalars().all(),
        )
        public_by_id = {row.id: row for row in public_rows}
        candidates = await self._evidence_backed_candidates(endpoint.id)
        if not candidates:
            return []

        actions: list[dict[str, Any]] = []
        role_order = list(DEFAULT_ROLE_CHAIN_SPECS)
        for role in sorted(
            entries_by_role,
            key=lambda value: role_order.index(value) if value in role_order else 999,
        ):
            entries = entries_by_role[role]
            public = public_by_id.get(role)
            contract = (
                public.contract
                if public is not None and isinstance(public.contract, dict)
                else {}
            )
            if contract.get("autoRefill") is False:
                continue

            status = statuses.get(role)
            live_steps = []
            if status is not None:
                live_steps = [
                    step
                    for step in status["steps"]
                    if step["desired_enabled"]
                    and step["endpoint_selector"] == endpoint_selector
                    and step["state"] in ("active", "probing")
                ]
            live_count = len(live_steps)
            deficit = max(0, CHAIN_REFILL_MIN_LIVE_CANDIDATES_PER_ROLE - live_count)
            if deficit == 0:
                continue

            existing_keys = {entry.upstream_model_key for entry in entries}
            auto_count = sum(1 for entry in entries if entry.source == "auto")
            remaining_auto_budget = max(0, CHAIN_REFILL_MAX_AUTO_ENTRIES_PER_ROLE - auto_count)
            if remaining_auto_budget == 0:
                continue
            required_rank = _ROLE_REQUIRED_TIER.get(role, 3)
            ranked_rows = [
                row
                for row in candidates
                if row.upstream_model_id not in existing_keys
                and self._candidate_admissible(row, required_rank)
            ]
            ranked_rows.sort(
                key=lambda row: self._candidate_sort_key(row, required_rank),
            )
            if not ranked_rows:
                continue

            enabled_ordinals = [entry.ordinal for entry in entries if entry.enabled]
            next_ordinal = (max(enabled_ordinals) + 1) if enabled_ordinals else 0
            additions = min(
                deficit,
                CHAIN_REFILL_MAX_ENTRIES_PER_PASS,
                remaining_auto_budget,
                len(ranked_rows),
            )
            live_families = {
                str(step["family"]).lower()
                for step in live_steps
                if isinstance(step.get("family"), str)
                and step.get("family")
                and str(step["family"]).lower() != "unknown"
            }
            selected_rows = self._select_candidates(
                ranked_rows,
                additions,
                public_model_id=role,
                live_families=live_families,
            )
            for index, upstream in enumerate(selected_rows):
                caps = dict(upstream.capabilities or {})
                actions.append({
                    "public_model_id": role,
                    "endpoint_selector": endpoint_selector,
                    "upstream_model_key": upstream.upstream_model_id,
                    "upstream_row_id": upstream.id,
                    "family": infer_model_family(upstream.upstream_model_id, caps),
                    "ordinal": next_ordinal + index,
                    "evidence_tier": caps.get("evidence_tier"),
                    "emergency_tail": caps.get("evidence_tier") == "emergency_tail",
                    "probe_latency_ms": caps.get("probe_latency_ms"),
                })
        return actions

    async def shadow_rescue_refill(
        self,
        *,
        public_model_id: str | None = None,
        endpoint_selector: str = REFORMBOSS_ENDPOINT_SELECTOR,
    ) -> list[dict[str, Any]]:
        """Phase-1 observe-only mode: log what refill would do, write nothing."""
        actions = await self.plan_rescue_refill(
            public_model_id=public_model_id,
            endpoint_selector=endpoint_selector,
        )
        for action in actions:
            logger.info(
                "Chain refill shadow: role %s would add auto entry %s at ordinal %s "
                "(tier=%s, latency=%sms)",
                action["public_model_id"],
                action["upstream_model_key"],
                action["ordinal"],
                action["evidence_tier"],
                action["probe_latency_ms"],
            )
        if not actions:
            logger.info(
                "Chain refill shadow: no deficit action needed or no evidence-backed candidates",
            )
        return actions

    async def apply_rescue_refill(
        self,
        *,
        public_model_id: str | None = None,
        endpoint_selector: str = REFORMBOSS_ENDPOINT_SELECTOR,
    ) -> list[dict[str, Any]]:
        """Append planned auto entries and materialize them as quarantined targets."""
        actions = await self.plan_rescue_refill(
            public_model_id=public_model_id,
            endpoint_selector=endpoint_selector,
        )
        if not actions:
            return []

        now = _utcnow()
        written: list[dict[str, Any]] = []
        catalog = RoleCatalogService(self._db)
        for action in actions:
            existing = await catalog._entry_by_key(
                action["public_model_id"],
                action["endpoint_selector"],
                action["upstream_model_key"],
            )
            if existing is not None:
                # Manual wins races by ownership.  Refill re-reads and converges
                # on a later pass rather than fighting an operator edit.
                continue
            self._db.add(
                RoleChainEntry(
                    public_model_id=action["public_model_id"],
                    endpoint_selector=action["endpoint_selector"],
                    upstream_model_key=action["upstream_model_key"],
                    family=action["family"],
                    ordinal=action["ordinal"],
                    enabled=True,
                    source="auto",
                    created_at=now,
                ),
            )
            written.append(action)
            logger.info(
                "Chain refill: role %s deficit-filled with auto entry %s at ordinal %s",
                action["public_model_id"],
                action["upstream_model_key"],
                action["ordinal"],
            )
        if not written:
            await self._db.flush()
            return []
        await self._db.flush()
        # Materialization stays in the existing writer: new rows become
        # quarantined RouteTargets with enabled=False, never active targets.
        await catalog.reconcile_all()
        return written

    async def detect_rotation(
        self,
        *,
        endpoint_selector: str = REFORMBOSS_ENDPOINT_SELECTOR,
        probe_pass_seconds: int = CHAIN_ROTATION_WINDOW_SECONDS // 2,
    ) -> dict[str, Any] | None:
        """Detect endpoint-scoped upstream rotation and persist the visible event.

        Signal A consumes recent role-target lifecycle transitions; Signal B is
        a conservative catalog mass-diff.  Either signal writes a bounded,
        timestamped ``chainRotation`` state into endpoint health policy.  The
        write is additive JSON state (no schema migration) and preserves all
        operator-supplied health-policy keys.
        """
        endpoint = await self._endpoint_for_selector(endpoint_selector)
        if endpoint is None or not endpoint.enabled:
            return None
        now = _utcnow()

        existing = rotation_state(endpoint.health_policy)
        if existing is not None and rotation_state_active(endpoint.health_policy, now):
            # Detection time anchors the bounded burst.  Re-detection inside the
            # window must not extend it or repeatedly spam the operator log.
            return existing

        event = await self._detect_health_rotation(
            endpoint,
            endpoint_selector,
            now,
            window_seconds=max(1, probe_pass_seconds) * 2,
        )
        if event is None:
            event = await self._detect_catalog_rotation(endpoint, now)
        if event is None:
            return None

        state = {
            "signal": event["signal"],
            "detectedAt": now.astimezone(UTC).isoformat(),
            "message": CHAIN_ROTATION_MESSAGE,
            **{key: value for key, value in event.items() if key != "signal"},
        }
        policy = dict(endpoint.health_policy or {})
        policy[CHAIN_ROTATION_STATE_KEY] = state
        endpoint.health_policy = policy
        endpoint.updated_at = now
        await self._db.flush()
        logger.warning(
            "upstream rotation detected on endpoint %s (%s); rederiving chains — %s",
            endpoint.id,
            event["signal"],
            event,
        )
        return dict(state)

    async def detect_and_apply_refill(
        self,
        *,
        endpoint_selector: str = REFORMBOSS_ENDPOINT_SELECTOR,
        probe_pass_seconds: int = CHAIN_ROTATION_WINDOW_SECONDS // 2,
    ) -> list[dict[str, Any]]:
        """Run rotation detection, then immediately compose any deficit refill."""
        await self.detect_rotation(
            endpoint_selector=endpoint_selector,
            probe_pass_seconds=probe_pass_seconds,
        )
        return await self.apply_rescue_refill(endpoint_selector=endpoint_selector)

    async def _detect_health_rotation(
        self,
        endpoint: ProviderEndpoint,
        endpoint_selector: str,
        now: datetime,
        *,
        window_seconds: int = CHAIN_ROTATION_WINDOW_SECONDS,
    ) -> dict[str, Any] | None:
        desired_rows = (
            await self._db.execute(
                select(
                    RoleChainEntry.public_model_id,
                    RoleChainEntry.upstream_model_key,
                ).where(
                    RoleChainEntry.endpoint_selector == endpoint_selector,
                    RoleChainEntry.enabled.is_(True),
                ),
            )
        ).all()
        desired_pairs = {(public_id, upstream_key) for public_id, upstream_key in desired_rows}
        if not desired_pairs:
            return None

        rows = (
            await self._db.execute(
                select(RouteTarget, UpstreamModel)
                .join(UpstreamModel, UpstreamModel.id == RouteTarget.upstream_model_id)
                .where(
                    UpstreamModel.provider_endpoint_id == endpoint.id,
                    RouteTarget.public_model_id.like("rb/%"),
                ),
            )
        ).all()
        cutoff = now - timedelta(seconds=window_seconds)
        policy = dict(endpoint.health_policy or {})
        watch_raw = policy.get(CHAIN_ROTATION_WATCH_KEY)
        baseline_keys: set[str] = set()
        if isinstance(watch_raw, dict):
            raw_keys = watch_raw.get("activeModelKeys")
            if isinstance(raw_keys, list):
                baseline_keys = {str(key) for key in raw_keys if isinstance(key, str)}
        desired_keys = {upstream_key for _public_id, upstream_key in desired_pairs}
        baseline_keys &= desired_keys

        active_upstream_ids: set[str] = set()
        active_keys: set[str] = set()
        demoted: dict[str, tuple[str, str]] = {}
        for target, upstream in rows:
            if (target.public_model_id, upstream.upstream_model_id) not in desired_pairs:
                continue
            if target.enabled and target.lifecycle_status == "active":
                active_upstream_ids.add(upstream.id)
                active_keys.add(upstream.upstream_model_id)
            updated_at = as_utc(target.lifecycle_updated_at)
            reason = target.lifecycle_reason or ""
            if (
                target.lifecycle_status == "demoted"
                and reason in CHAIN_ROTATION_MODEL_SCOPED_REASONS
                and updated_at is not None
                and updated_at >= cutoff
            ):
                demoted[upstream.id] = (upstream.upstream_model_id, reason)

        # Keep a durable pre-pass active-model baseline in additive endpoint
        # JSON.  Without this, a first-probe failure of a never-active
        # quarantined factory seed is indistinguishable from a true previously
        # active model dying; the design's Signal A counts only the latter.
        sorted_active_keys = sorted(active_keys)
        existing_keys = []
        if isinstance(watch_raw, dict) and isinstance(watch_raw.get("activeModelKeys"), list):
            existing_keys = sorted(
                str(key) for key in watch_raw["activeModelKeys"] if isinstance(key, str)
            )
        if existing_keys != sorted_active_keys:
            policy[CHAIN_ROTATION_WATCH_KEY] = {
                "activeModelKeys": sorted_active_keys,
                "observedAt": now.astimezone(UTC).isoformat(),
            }
            endpoint.health_policy = policy
            endpoint.updated_at = now

        # A model still active for any rb/* role is not dead upstream; partial
        # target state is repair noise, not a rotation signal.
        newly_demoted = {
            upstream_id: value
            for upstream_id, value in demoted.items()
            if upstream_id not in active_upstream_ids and value[0] in baseline_keys
        }
        denominator = len(baseline_keys)
        demoted_count = len(newly_demoted)
        if denominator == 0 or demoted_count < CHAIN_ROTATION_MIN_DEMOTED_MODELS:
            return None
        fraction = demoted_count / denominator
        if fraction < CHAIN_ROTATION_DEMOTED_FRACTION:
            return None
        return {
            "signal": "health",
            "demoted_count": demoted_count,
            "active_count": len(active_upstream_ids),
            "previously_active_count": denominator,
            "fraction": fraction,
            "model_keys": sorted(value[0] for value in newly_demoted.values())[
                :CHAIN_ROTATION_MAX_EVENT_MODEL_KEYS
            ],
            "reasons": sorted({value[1] for value in newly_demoted.values()}),
        }

    async def _detect_catalog_rotation(
        self,
        endpoint: ProviderEndpoint,
        now: datetime,
    ) -> dict[str, Any] | None:
        rows = list(
            (
                await self._db.execute(
                    select(UpstreamModel).where(UpstreamModel.provider_endpoint_id == endpoint.id),
                )
            ).scalars().all(),
        )
        if not rows:
            return None
        cutoff = now - timedelta(
            seconds=CHAIN_ROTATION_CATALOG_PASS_SECONDS * CHAIN_ROTATION_CATALOG_PASSES,
        )
        baseline_count = 0
        missing_keys: list[str] = []
        new_keys: list[str] = []
        for row in rows:
            created_at = as_utc(row.created_at)
            last_seen_at = as_utc(row.last_seen_at)
            if last_seen_at is None:
                continue
            # ``last_seen_at`` is the proof that the model was once present in
            # the catalog.  A stale timestamp is evidence of absence for two
            # discovery passes; a recent timestamp only joins the baseline when
            # the row already existed at the window edge.
            if (
                created_at is not None and created_at <= cutoff
            ) or last_seen_at <= cutoff:
                baseline_count += 1
                if last_seen_at <= cutoff:
                    missing_keys.append(row.upstream_model_id)
            elif created_at is not None and created_at >= cutoff:
                new_keys.append(row.upstream_model_id)

        missing_count = len(missing_keys)
        if (
            baseline_count == 0
            or missing_count < CHAIN_ROTATION_CATALOG_MIN_MISSING
            or len(new_keys) < CHAIN_ROTATION_CATALOG_MIN_NEW_MODELS
        ):
            return None
        fraction = missing_count / baseline_count
        if fraction < CHAIN_ROTATION_CATALOG_MISSING_FRACTION:
            return None
        return {
            "signal": "catalog",
            "missing_count": missing_count,
            "baseline_count": baseline_count,
            "new_count": len(new_keys),
            "fraction": fraction,
            "missing_model_keys": sorted(missing_keys)[:CHAIN_ROTATION_MAX_EVENT_MODEL_KEYS],
            "new_model_keys": sorted(new_keys)[:CHAIN_ROTATION_MAX_EVENT_MODEL_KEYS],
        }

    async def _endpoint_for_selector(self, selector: str) -> ProviderEndpoint | None:
        rows = list(
            (
                await self._db.execute(
                    select(ProviderEndpoint).order_by(
                        ProviderEndpoint.created_at.asc(),
                        ProviderEndpoint.id.asc(),
                    ),
                )
            ).scalars().all(),
        )
        tagged = [
            row
            for row in rows
            if isinstance(row.health_policy, dict) and row.health_policy.get("roleCatalog") == selector
        ]
        if tagged:
            return tagged[0]
        if selector == REFORMBOSS_ENDPOINT_SELECTOR:
            return next(
                (row for row in rows if _normalized_base_url(row.base_url) == REFORMBOSS_BASE_URL),
                None,
            )
        return None

    async def _evidence_backed_candidates(self, endpoint_id: str) -> list[UpstreamModel]:
        rows = list(
            (
                await self._db.execute(
                    select(UpstreamModel).where(
                        UpstreamModel.provider_endpoint_id == endpoint_id,
                        UpstreamModel.enabled.is_(True),
                    ),
                )
            ).scalars().all(),
        )
        return [row for row in rows if self._evidence_backed(row)]

    @staticmethod
    def _select_candidates(
        ranked_rows: list[UpstreamModel],
        additions: int,
        *,
        public_model_id: str,
        live_families: set[str],
    ) -> list[UpstreamModel]:
        """Greedily select ranked rows, preferring reviewer family diversity.

        Diversity is best-effort composition, never admission policy: unknown
        families neither block nor manufacture diversity, and when no different
        known family exists the highest-evidence ranked candidate is kept.
        """
        if additions <= 0:
            return []
        if not role_prefers_family_diversity(public_model_id):
            return ranked_rows[:additions]
        remaining = list(ranked_rows)
        selected: list[UpstreamModel] = []
        used_families = set(live_families)
        while remaining and len(selected) < additions:
            choose_index = 0
            if used_families:
                diverse_index: int | None = None
                best_caps = remaining[0].capabilities or {}
                best_is_tail = best_caps.get("evidence_tier") == "emergency_tail"
                for index, row in enumerate(remaining):
                    row_caps = row.capabilities or {}
                    if not best_is_tail and row_caps.get("evidence_tier") == "emergency_tail":
                        continue  # diversity never downgrades nominal-tier evidence to a tail
                    family = infer_model_family(row.upstream_model_id, row_caps)
                    if family != "unknown" and family not in used_families:
                        diverse_index = index
                        break
                if diverse_index is not None:
                    choose_index = diverse_index
            chosen = remaining.pop(choose_index)
            selected.append(chosen)
            family = infer_model_family(chosen.upstream_model_id, chosen.capabilities or {})
            if family != "unknown":
                used_families.add(family)
        return selected

    @staticmethod
    def _evidence_backed(upstream: UpstreamModel) -> bool:
        caps = upstream.capabilities or {}
        if caps.get("coherence_passed") is not True:
            return False
        if caps.get("evidence_tier") not in ("strong", "mid", "fast", "emergency_tail"):
            return False
        # Invocability failures do not erase coherence/tier memory.  Access
        # rows and the exact-probe lifecycle already decide what may serve;
        # refill uses only positive semantic evidence plus the model-death
        # stickiness window below.  In particular, key-scoped entitlement
        # denial must not veto tier memory for future key classes.
        failure_raw = caps.get("last_model_failure_at")
        if isinstance(failure_raw, str) and failure_raw:
            failed_at = parse_iso_utc(failure_raw)
            if failed_at is None:
                return False
            age = (_utcnow() - failed_at).total_seconds()
            if age < CHAIN_REFILL_READD_STICKINESS_SECONDS:
                return False
        return True

    @staticmethod
    def _candidate_admissible(upstream: UpstreamModel, required_rank: int) -> bool:
        caps = upstream.capabilities or {}
        tier = caps.get("evidence_tier")
        if tier == "emergency_tail":
            return True
        if tier == "strong" and required_rank >= 3 and caps.get("usage_sane") is False:
            # Fabricated accounting is a supplier-integrity red flag for lead-
            # class admission, but not a coherence veto for lower tiers.
            return False
        return tier_rank(tier) >= required_rank

    @staticmethod
    def _candidate_sort_key(
        upstream: UpstreamModel,
        required_rank: int,
    ) -> tuple[int, int, int, str]:
        caps = upstream.capabilities or {}
        tier = caps.get("evidence_tier")
        if tier == "emergency_tail":
            tier_group = 2
            distance = 0
        else:
            rank = tier_rank(tier)
            tier_group = 0 if rank == required_rank else 1
            distance = max(0, rank - required_rank)
        usage_penalty = 1 if caps.get("usage_sane") is False else 0
        latency = caps.get("probe_latency_ms")
        latency_key = (
            latency if isinstance(latency, int) and not isinstance(latency, bool) else 999_999
        )
        return (
            tier_group,
            usage_penalty,
            distance * 100_000 + latency_key,
            upstream.upstream_model_id,
        )
