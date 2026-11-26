"""Rescue-only desired-chain refill writer for rb/* role models.

The service composes *desired state only*.  It appends ``source='auto'``
entries for evidence-backed catalog models when a role has no active or
probing enabled entry left.  Materialization and activation remain owned by
``RoleCatalogService`` and the exact-probe lifecycle respectively, so refill
can choose what to try but can never make a model serve directly.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from stitch_backend.domains.ai_gateway.model_evidence import tier_rank
from stitch_backend.domains.ai_gateway.models import (
    ProviderEndpoint,
    PublicModel,
    RoleChainEntry,
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

# Rescue policy constants live in one inspectable place.  Phase 2 is additive
# only: it never disables or deletes entries.  The cap is therefore on the
# number of auto rescue attempts per role, not on total chain rows (the dead
# factory/manual rows remain visible and operator-owned).
CHAIN_REFILL_RESCUE_ENTRIES_PER_PASS = 2
CHAIN_REFILL_MAX_AUTO_ENTRIES_PER_ROLE = 4
CHAIN_REFILL_READD_STICKINESS_SECONDS = 6 * 60 * 60

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
    """Compose rescue-only auto entries; no-commit discipline like sibling services."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def plan_rescue_refill(
        self,
        *,
        public_model_id: str | None = None,
        endpoint_selector: str = REFORMBOSS_ENDPOINT_SELECTOR,
    ) -> list[dict[str, Any]]:
        """Return rescue additions that would be written, without writing them."""
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
            active_or_probing = False
            if status is not None:
                active_or_probing = any(
                    step["desired_enabled"] and step["state"] in ("active", "probing")
                    for step in status["steps"]
                )
            if active_or_probing:
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
                CHAIN_REFILL_RESCUE_ENTRIES_PER_PASS,
                remaining_auto_budget,
                len(ranked_rows),
            )
            for index, upstream in enumerate(ranked_rows[:additions]):
                caps = dict(upstream.capabilities or {})
                actions.append({
                    "public_model_id": role,
                    "endpoint_selector": endpoint_selector,
                    "upstream_model_key": upstream.upstream_model_id,
                    "upstream_row_id": upstream.id,
                    "family": "unknown",
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
                "Chain refill shadow: no rescue action needed or no evidence-backed candidates",
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
                "Chain refill: role %s rescued with auto entry %s at ordinal %s",
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
            try:
                failed_at = datetime.fromisoformat(failure_raw.replace("Z", "+00:00"))
            except ValueError:
                return False
            if failed_at.tzinfo is None:
                failed_at = failed_at.replace(tzinfo=UTC)
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
