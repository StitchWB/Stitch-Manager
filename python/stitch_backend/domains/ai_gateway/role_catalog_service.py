"""Role catalog service — desired rb/* role chains materialized into gateway routes.

The service owns virtual public models such as ``rb/lead`` and the additive
``ai_gateway_role_chain_entries`` desired-state table.  It never commits: like
other ai_gateway services it flushes and leaves transaction ownership to the
caller (``run_in_session``/command decorator/startup).

Routing itself is deliberately unchanged.  Materialized targets start
``enabled=False`` in ``quarantined``; only exact-model health evidence may
move them to ``active``.  Legacy rows (``managed_by IS NULL``) and rows marked
``manual`` are never rewritten by this automation.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select

from stitch_backend.domains.ai_gateway.model_identity import (
    canonical_model_key,
    humanize_model_id,
)
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialModelAccess,
    ProviderEndpoint,
    PublicModel,
    RoleChainEntry,
    RouteTarget,
    UpstreamModel,
    _utcnow,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

REFORMBOSS_ENDPOINT_SELECTOR = "reformboss"
REFORMBOSS_BASE_URL = "https://api.reformboss.com/v1"
ROLE_MANAGED_BY = "role_catalog"

PROBE_BACKOFF_BASE_SECONDS = 300
PROBE_BACKOFF_CAP_SECONDS = 3600

# ``(exact upstream id, family)`` tuples in desired priority order.  These are
# product input, not discovered inventory: absence from the live ReformBoss
# catalog must not remove the desired entry.
RoleChainStep = tuple[str, str]
DEFAULT_ROLE_CHAIN_SPECS: dict[str, tuple[RoleChainStep, ...]] = {
    "rb/lead": (
        ("kimi-k3", "moonshot"),
        ("glm-5.4", "zhipu"),
        ("gemini-4-carbon", "google"),
        ("deepseek-v4-pro", "deepseek"),
    ),
    "rb/planner": (
        ("gemini-4-carbon", "google"),
        ("deepseek-v4-pro", "deepseek"),
        ("kimi-k3", "moonshot"),
        ("gpt-6-luna", "openai"),
    ),
    "rb/researcher": (
        ("gemini-4-argon", "google"),
        ("qwen3.8-max", "qwen"),
        ("kimi-k3", "moonshot"),
    ),
    "rb/builder": (
        ("glm-5.4", "zhipu"),
        ("kimi-k3", "moonshot"),
        ("deepseek-v4-pro", "deepseek"),
        ("deepseek-v4.1-flash", "deepseek"),
    ),
    "rb/builder-fast": (
        ("deepseek-v4.1-flash", "deepseek"),
        ("gpt-6-luna", "openai"),
        ("glm-5.3", "zhipu"),
    ),
    "rb/reviewer-correctness": (
        ("gemini-4-carbon", "google"),
        ("claude-fable-5-2", "anthropic"),
        ("deepseek-v4-pro", "deepseek"),
    ),
    "rb/reviewer-adversarial": (
        ("gpt-6-luna", "openai"),
        ("gemini-4-argon", "google"),
        ("glm-5.4", "zhipu"),
    ),
    "rb/verifier": (
        ("deepseek-v4.1-flash", "deepseek"),
        ("gpt-6-luna", "openai"),
        ("glm-5.3", "zhipu"),
    ),
    "rb/small": (
        ("deepseek-v4.1-flash-1017", "deepseek"),
        ("deepseek-v4.1-flash", "deepseek"),
        ("glm-5.3", "zhipu"),
    ),
}

_MODEL_SCOPED_REASONS = frozenset(
    {
        "model_not_found",
        "model_access_denied",
        "empty_completion",
        "no_channel",
        "no_channel_for_model",
        "token_model_not_allowed",
        "provider_forbidden",
    }
)
_DENIED_REASONS = frozenset(
    {
        "model_access_denied",
        "token_model_not_allowed",
        "provider_forbidden",
    }
)


def _empty_stats() -> dict[str, int]:
    return {
        "public_models_created": 0,
        "role_entries_created": 0,
        "role_entries_updated": 0,
        "upstream_models_created": 0,
        "route_targets_created": 0,
        "route_targets_updated": 0,
        "route_targets_skipped": 0,
        "endpoints_matched": 0,
        "conflicts": 0,
    }


def _normalized_base_url(value: str) -> str:
    return value.strip().rstrip("/").lower()


def _priority_for_ordinal(ordinal: int) -> int:
    return 10 * (max(0, ordinal) + 1)


def _utc_iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


class RoleCatalogService:
    """Reconcile virtual role catalog desired state into catalog/runtime rows."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Reconciliation ──────────────────────────────────────────────────────

    async def reconcile_all(self) -> dict[str, int]:
        """Seed roles/entries and materialize them when ReformBoss is configured.

        Absence of the endpoint is normal in development and tests: public
        role models and desired entries are still created, while upstream and
        route-target materialization simply waits for a later reconciliation.
        """
        stats = _empty_stats()
        conflicts = await self._seed_catalog(stats)
        endpoint = await self._find_reformboss_endpoint()
        if endpoint is not None:
            stats["endpoints_matched"] = 1
            await self._materialize_endpoint(endpoint, conflicts, stats)
        await self._db.flush()
        return stats

    async def reconcile_endpoint(self, endpoint: ProviderEndpoint) -> dict[str, int]:
        """Reconcile after a matching endpoint appears or finishes discovery."""
        stats = _empty_stats()
        if not self._endpoint_matches(endpoint):
            await self._db.flush()
            return stats
        stats["endpoints_matched"] = 1
        conflicts = await self._seed_catalog(stats)
        await self._materialize_endpoint(endpoint, conflicts, stats)
        await self._db.flush()
        return stats

    async def reconcile_health(self) -> dict[str, int]:
        """Control-plane health sweep for already materialized role targets.

        This is passive-only: it demotes active role targets when no eligible
        ``available`` credential/model access row remains.  It never probes the
        network and never reactivates anything — exact probe success is the
        only activation path.
        """
        stats = _empty_stats()
        rows = (
            await self._db.execute(
                select(RouteTarget, UpstreamModel)
                .join(UpstreamModel, UpstreamModel.id == RouteTarget.upstream_model_id)
                .where(RouteTarget.managed_by == ROLE_MANAGED_BY)
            )
        ).all()
        for target, upstream in rows:
            entry = await self._entry_for_upstream(
                target.public_model_id, upstream.upstream_model_id
            )
            if entry is not None and not entry.enabled:
                if await self._disable_target_for_desired_disabled(target):
                    stats["route_targets_updated"] += 1
                continue
            if target.lifecycle_status != "active":
                continue
            if await self._has_usable_access(upstream.id):
                continue
            target.enabled = False
            self._set_lifecycle(target, "demoted", "no_usable_access")
            stats["route_targets_updated"] += 1
        await self._db.flush()
        return stats

    # ── Health evidence (implemented here; wired to workers/routing in Phase 3) ──

    async def note_upstream_outcome(
        self,
        *,
        endpoint_id: str,
        upstream_model_id: str,
        error: Any,
    ) -> None:
        """Re-evaluate role targets after live traffic already updated access rows.

        ``upstream_model_id`` accepts the DB row id used by ``record_result``;
        as a convenience it also accepts the exact upstream model string.  Only
        model-scoped failures matter.  Demotion happens only when no usable
        ``available`` access row remains, preventing one bad key from flapping
        a model that other keys can still serve.
        """
        if error is None or not self._error_is_model_scoped(error):
            return
        upstream = await self._resolve_upstream_reference(endpoint_id, upstream_model_id)
        if upstream is None:
            return
        reason = self._error_reason(error)
        if await self._has_usable_access(upstream.id):
            return
        targets = await self._role_targets_for_upstream(upstream.id)
        for target in targets:
            entry = await self._entry_for_upstream(
                target.public_model_id,
                upstream.upstream_model_id,
            )
            if entry is not None and not entry.enabled:
                continue
            if (
                target.enabled
                or target.lifecycle_status != "demoted"
                or target.lifecycle_reason != reason
            ):
                target.enabled = False
                self._set_lifecycle(target, "demoted", reason)
        await self._db.flush()

    async def apply_model_probe_result(
        self,
        *,
        credential_id: str,
        upstream_model_id: str,
        probe_row: Mapping[str, Any],
    ) -> None:
        """Apply one exact ``(credential, upstream model)`` probe outcome.

        Success is the sole automatic activation path.  Model-scoped failure
        backs off that exact pair and demotes role targets; key/account/
        endpoint-scoped failures are deliberately ignored here because they do
        not prove anything about the model.
        """
        credential = await self._db.get(Credential, credential_id)
        if credential is None:
            return
        upstream = await self._resolve_upstream_reference(
            credential.provider_endpoint_id,
            upstream_model_id,
        )
        if upstream is None:
            return

        now = _utcnow()
        access = await self._access_row(credential_id, upstream.id)
        if access is None:
            access = CredentialModelAccess(
                credential_id=credential_id,
                upstream_model_id=upstream.id,
                status="unknown",
                created_at=now,
            )
            self._db.add(access)
            await self._db.flush()

        reason = str(probe_row.get("reason") or ("ok" if probe_row.get("ok") else "unknown"))
        if probe_row.get("ok") is True:
            access.status = "available"
            access.last_error = None
            access.last_verified_at = now
            access.probe_failures = 0
            access.next_probe_at = None
            access.updated_at = now
            self._merge_probe_capabilities(upstream, probe_row, now, success=True)
            await self._activate_targets_after_probe(upstream, now)
            await self._db.flush()
            return

        if not self._probe_failure_is_model_scoped(reason, probe_row):
            await self._db.flush()
            return

        access.status = "denied" if reason in _DENIED_REASONS else "temporarily_unavailable"
        access.last_error = reason
        access.last_verified_at = now
        failures = int(access.probe_failures or 0) + 1
        access.probe_failures = failures
        access.next_probe_at = now + timedelta(seconds=self._probe_backoff_seconds(failures))
        access.updated_at = now
        self._merge_probe_capabilities(upstream, probe_row, now, success=False)

        for target in await self._role_targets_for_upstream(upstream.id):
            target.enabled = False
            self._set_lifecycle(target, "demoted", reason)
        await self._db.flush()

    # ── Operator-facing desired-entry helpers ───────────────────────────────

    async def list_entries(
        self,
        *,
        public_model_id: str | None = None,
        endpoint_selector: str | None = None,
    ) -> list[RoleChainEntry]:
        stmt = select(RoleChainEntry).order_by(
            RoleChainEntry.public_model_id.asc(),
            RoleChainEntry.ordinal.asc(),
            RoleChainEntry.upstream_model_key.asc(),
        )
        if public_model_id is not None:
            stmt = stmt.where(RoleChainEntry.public_model_id == public_model_id)
        if endpoint_selector is not None:
            stmt = stmt.where(RoleChainEntry.endpoint_selector == endpoint_selector)
        result = await self._db.execute(stmt)
        return list(result.scalars().all())

    async def upsert_entry(
        self,
        *,
        public_model_id: str,
        upstream_model_key: str,
        endpoint_selector: str = REFORMBOSS_ENDPOINT_SELECTOR,
        family: str | None = None,
        ordinal: int = 0,
        enabled: bool = True,
    ) -> RoleChainEntry:
        await self._ensure_public_model_for_operator(public_model_id)
        existing = await self._entry_by_key(
            public_model_id,
            endpoint_selector,
            upstream_model_key,
        )
        now = _utcnow()
        if existing is None:
            existing = RoleChainEntry(
                public_model_id=public_model_id,
                endpoint_selector=endpoint_selector,
                upstream_model_key=upstream_model_key,
                family=family,
                ordinal=ordinal,
                enabled=enabled,
                source="manual",
                created_at=now,
            )
            self._db.add(existing)
        else:
            existing.family = family
            existing.ordinal = ordinal
            existing.enabled = enabled
            existing.source = "manual"
            existing.updated_at = now
        await self._db.flush()
        return existing

    async def disable_entry(self, entry_id: str) -> RoleChainEntry | None:
        entry = await self._db.get(RoleChainEntry, entry_id)
        if entry is None:
            return None
        entry.enabled = False
        entry.source = "manual"
        entry.updated_at = _utcnow()
        await self._db.flush()
        return entry

    async def reset_entry_to_default(self, entry_id: str) -> RoleChainEntry | None:
        entry = await self._db.get(RoleChainEntry, entry_id)
        if entry is None:
            return None
        chain = DEFAULT_ROLE_CHAIN_SPECS.get(entry.public_model_id)
        if chain is None:
            raise ValueError(f"No factory default chain for {entry.public_model_id}")
        matches = [
            (index, upstream, family)
            for index, (upstream, family) in enumerate(chain)
            if upstream == entry.upstream_model_key
        ]
        if not matches:
            raise ValueError(
                f"No factory default entry {entry.upstream_model_key} for {entry.public_model_id}",
            )
        ordinal, _upstream, family = matches[0]
        entry.ordinal = ordinal
        entry.family = family
        entry.enabled = True
        entry.source = "default"
        entry.updated_at = _utcnow()
        await self._db.flush()
        return entry

    async def mark_target_manual_override(
        self,
        target: RouteTarget,
        updates: Mapping[str, Any],
    ) -> None:
        """Protect a generic route-target edit from later automation.

        Both layers become manual: the desired entry records the operator's
        intent, and the runtime target leaves role-catalog ownership so a later
        reconcile cannot reverse an operator enable/priority decision.
        """
        entry = await self._entry_for_target(target)
        if entry is not None:
            entry.source = "manual"
            if "enabled" in updates and updates["enabled"] is not None:
                entry.enabled = bool(updates["enabled"])
            if "priority" in updates and updates["priority"] is not None:
                entry.ordinal = max(0, int(updates["priority"]) // 10 - 1)
            entry.updated_at = _utcnow()
        target.managed_by = "manual"
        target.lifecycle_reason = "manual_override"
        target.lifecycle_updated_at = _utcnow()
        await self._db.flush()

    async def disable_entry_for_target(
        self,
        target: RouteTarget,
        *,
        reason: str = "manual_delete",
    ) -> None:
        """Tombstone the desired entry represented by a role-managed target."""
        entry = await self._entry_for_target(target)
        if entry is not None:
            entry.enabled = False
            entry.source = "manual"
            entry.updated_at = _utcnow()
        target.enabled = False
        target.lifecycle_reason = reason
        target.lifecycle_updated_at = _utcnow()
        await self._db.flush()

    # ── Catalog seeding ─────────────────────────────────────────────────────

    async def _seed_catalog(self, stats: dict[str, int]) -> set[str]:
        conflicts = await self._ensure_role_public_models(stats)
        stats["conflicts"] += len(conflicts)
        await self._seed_default_entries(conflicts, stats)
        return conflicts

    async def _ensure_role_public_models(self, stats: dict[str, int]) -> set[str]:
        conflicts: set[str] = set()
        for role in DEFAULT_ROLE_CHAIN_SPECS:
            public = await self._db.get(PublicModel, role)
            if public is None:
                self._db.add(
                    PublicModel(
                        id=role,
                        display_name=role,
                        enabled=True,
                        owner_id=None,
                        created_at=_utcnow(),
                    )
                )
                stats["public_models_created"] += 1
                continue
            if public.owner_id is not None:
                conflicts.add(role)
                logger.warning(
                    "Role catalog conflict: %s is owned by user %s; automation skips it",
                    role,
                    public.owner_id,
                )
        await self._db.flush()
        return conflicts

    async def _seed_default_entries(
        self,
        conflicts: set[str],
        stats: dict[str, int],
    ) -> None:
        result = await self._db.execute(
            select(RoleChainEntry).where(
                RoleChainEntry.endpoint_selector == REFORMBOSS_ENDPOINT_SELECTOR,
            ),
        )
        existing_rows = list(result.scalars().all())
        by_key = {
            (row.public_model_id, row.endpoint_selector, row.upstream_model_key): row
            for row in existing_rows
        }
        valid_keys: set[tuple[str, str, str]] = set()
        now = _utcnow()

        for role, chain in DEFAULT_ROLE_CHAIN_SPECS.items():
            if role in conflicts:
                continue
            for ordinal, (upstream, family) in enumerate(chain):
                key = (role, REFORMBOSS_ENDPOINT_SELECTOR, upstream)
                valid_keys.add(key)
                row = by_key.get(key)
                if row is None:
                    self._db.add(
                        RoleChainEntry(
                            public_model_id=role,
                            endpoint_selector=REFORMBOSS_ENDPOINT_SELECTOR,
                            upstream_model_key=upstream,
                            family=family,
                            ordinal=ordinal,
                            enabled=True,
                            source="default",
                            created_at=now,
                        )
                    )
                    stats["role_entries_created"] += 1
                    continue
                if row.source == "manual":
                    continue
                changed = False
                if row.family != family:
                    row.family = family
                    changed = True
                if row.ordinal != ordinal:
                    row.ordinal = ordinal
                    changed = True
                if not row.enabled:
                    row.enabled = True
                    changed = True
                if changed:
                    row.updated_at = now
                    stats["role_entries_updated"] += 1

        # Factory defaults can shrink across versions.  Automation-owned rows
        # that disappeared from the constants are soft-disabled; manual rows
        # remain operator-owned and are never rewritten here.
        for row in existing_rows:
            key = (row.public_model_id, row.endpoint_selector, row.upstream_model_key)
            if row.source == "manual" or key in valid_keys:
                continue
            if row.public_model_id in conflicts:
                continue
            if row.enabled:
                row.enabled = False
                row.updated_at = now
                stats["role_entries_updated"] += 1
        await self._db.flush()

    # ── Materialization ─────────────────────────────────────────────────────

    async def _materialize_endpoint(
        self,
        endpoint: ProviderEndpoint,
        conflicts: set[str],
        stats: dict[str, int],
    ) -> None:
        entries = await self.list_entries(endpoint_selector=REFORMBOSS_ENDPOINT_SELECTOR)
        for entry in entries:
            if entry.public_model_id in conflicts:
                continue
            upstream = await self._resolve_or_create_upstream(
                endpoint,
                entry.upstream_model_key,
                create=entry.enabled,
                stats=stats,
            )
            if upstream is None:
                continue
            target = await self._target_for(entry.public_model_id, upstream.id)
            if entry.enabled:
                await self._materialize_enabled_target(entry, upstream, target, stats)
            else:
                await self._materialize_disabled_target(target, stats)
        await self._db.flush()

    async def _resolve_or_create_upstream(
        self,
        endpoint: ProviderEndpoint,
        upstream_model_key: str,
        *,
        create: bool,
        stats: dict[str, int],
    ) -> UpstreamModel | None:
        result = await self._db.execute(
            select(UpstreamModel).where(
                UpstreamModel.provider_endpoint_id == endpoint.id,
                UpstreamModel.upstream_model_id == upstream_model_key,
            ),
        )
        existing = result.scalar_one_or_none()
        if existing is not None or not create:
            return existing
        now = _utcnow()
        upstream = UpstreamModel(
            provider_endpoint_id=endpoint.id,
            upstream_model_id=upstream_model_key,
            display_name=humanize_model_id(upstream_model_key),
            enabled=True,
            discovery_source="role_catalog",
            canonical_model_key=canonical_model_key(upstream_model_key),
            capabilities=None,
            last_discovered_at=now,
            created_at=now,
        )
        self._db.add(upstream)
        await self._db.flush()
        stats["upstream_models_created"] += 1
        return upstream

    async def _materialize_enabled_target(
        self,
        entry: RoleChainEntry,
        upstream: UpstreamModel,
        target: RouteTarget | None,
        stats: dict[str, int],
    ) -> None:
        priority = _priority_for_ordinal(entry.ordinal)
        now = _utcnow()
        if target is None:
            self._db.add(
                RouteTarget(
                    public_model_id=entry.public_model_id,
                    upstream_model_id=upstream.id,
                    enabled=False,
                    priority=priority,
                    weight=1.0,
                    cost_modifier=1.0,
                    managed_by=ROLE_MANAGED_BY,
                    lifecycle_status="quarantined",
                    lifecycle_reason="desired_unverified",
                    lifecycle_updated_at=now,
                    created_at=now,
                )
            )
            stats["route_targets_created"] += 1
            await self._db.flush()
            return

        if target.managed_by != ROLE_MANAGED_BY:
            stats["route_targets_skipped"] += 1
            return

        changed = False
        if target.priority != priority:
            target.priority = priority
            changed = True
        if target.lifecycle_status in (None, "discovered"):
            target.enabled = False
            self._set_lifecycle(target, "quarantined", "desired_unverified")
            changed = True
        elif target.lifecycle_status == "verified":
            target.enabled = True
            self._set_lifecycle(target, "active", "desired_reenabled")
            changed = True
        elif target.lifecycle_status == "active":
            if not target.enabled:
                target.enabled = True
                changed = True
        elif target.enabled:
            target.enabled = False
            changed = True
        if changed:
            target.updated_at = now
            stats["route_targets_updated"] += 1

    async def _materialize_disabled_target(
        self,
        target: RouteTarget | None,
        stats: dict[str, int],
    ) -> None:
        if target is None:
            return
        if target.managed_by != ROLE_MANAGED_BY:
            stats["route_targets_skipped"] += 1
            return
        if await self._disable_target_for_desired_disabled(target):
            stats["route_targets_updated"] += 1

    async def _disable_target_for_desired_disabled(self, target: RouteTarget) -> bool:
        changed = False
        if target.enabled:
            target.enabled = False
            changed = True
        if target.lifecycle_status in ("active", "verified"):
            if (
                target.lifecycle_status != "verified"
                or target.lifecycle_reason != "desired_disabled"
            ):
                self._set_lifecycle(target, "verified", "desired_disabled")
                changed = True
        elif target.lifecycle_reason != "desired_disabled":
            target.lifecycle_reason = "desired_disabled"
            target.lifecycle_updated_at = _utcnow()
            changed = True
        if changed:
            target.updated_at = _utcnow()
        return changed

    # ── Lookup helpers ──────────────────────────────────────────────────────

    async def _find_reformboss_endpoint(self) -> ProviderEndpoint | None:
        result = await self._db.execute(
            select(ProviderEndpoint).order_by(
                ProviderEndpoint.created_at.asc(),
                ProviderEndpoint.id.asc(),
            ),
        )
        rows = list(result.scalars().all())
        tagged = [row for row in rows if self._endpoint_is_tagged(row)]
        if tagged:
            return tagged[0]
        for row in rows:
            if _normalized_base_url(row.base_url) == REFORMBOSS_BASE_URL:
                return row
        return None

    @staticmethod
    def _endpoint_is_tagged(endpoint: ProviderEndpoint) -> bool:
        policy = endpoint.health_policy if isinstance(endpoint.health_policy, dict) else {}
        return policy.get("roleCatalog") == REFORMBOSS_ENDPOINT_SELECTOR

    def _endpoint_matches(self, endpoint: ProviderEndpoint) -> bool:
        return self._endpoint_is_tagged(endpoint) or (
            _normalized_base_url(endpoint.base_url) == REFORMBOSS_BASE_URL
        )

    async def _target_for(
        self,
        public_model_id: str,
        upstream_row_id: str,
    ) -> RouteTarget | None:
        result = await self._db.execute(
            select(RouteTarget).where(
                RouteTarget.public_model_id == public_model_id,
                RouteTarget.upstream_model_id == upstream_row_id,
            ),
        )
        return result.scalar_one_or_none()

    async def _entry_by_key(
        self,
        public_model_id: str,
        endpoint_selector: str,
        upstream_model_key: str,
    ) -> RoleChainEntry | None:
        result = await self._db.execute(
            select(RoleChainEntry).where(
                RoleChainEntry.public_model_id == public_model_id,
                RoleChainEntry.endpoint_selector == endpoint_selector,
                RoleChainEntry.upstream_model_key == upstream_model_key,
            ),
        )
        return result.scalar_one_or_none()

    async def _entry_for_upstream(
        self,
        public_model_id: str,
        upstream_model_key: str,
    ) -> RoleChainEntry | None:
        return await self._entry_by_key(
            public_model_id,
            REFORMBOSS_ENDPOINT_SELECTOR,
            upstream_model_key,
        )

    async def _entry_for_target(self, target: RouteTarget) -> RoleChainEntry | None:
        upstream = await self._db.get(UpstreamModel, target.upstream_model_id)
        if upstream is None:
            return None
        return await self._entry_for_upstream(
            target.public_model_id,
            upstream.upstream_model_id,
        )

    async def _ensure_public_model_for_operator(self, public_model_id: str) -> None:
        public = await self._db.get(PublicModel, public_model_id)
        if public is not None:
            return
        if public_model_id not in DEFAULT_ROLE_CHAIN_SPECS:
            raise ValueError(f"Public model not found: {public_model_id}")
        stats = _empty_stats()
        await self._ensure_role_public_models(stats)

    async def _resolve_upstream_reference(
        self,
        endpoint_id: str,
        upstream_model_id: str,
    ) -> UpstreamModel | None:
        upstream = await self._db.get(UpstreamModel, upstream_model_id)
        if upstream is not None and upstream.provider_endpoint_id == endpoint_id:
            return upstream
        result = await self._db.execute(
            select(UpstreamModel).where(
                UpstreamModel.provider_endpoint_id == endpoint_id,
                UpstreamModel.upstream_model_id == upstream_model_id,
            ),
        )
        return result.scalar_one_or_none()

    async def _role_targets_for_upstream(self, upstream_row_id: str) -> list[RouteTarget]:
        result = await self._db.execute(
            select(RouteTarget).where(
                RouteTarget.upstream_model_id == upstream_row_id,
                RouteTarget.managed_by == ROLE_MANAGED_BY,
            ),
        )
        return list(result.scalars().all())

    async def _access_row(
        self,
        credential_id: str,
        upstream_row_id: str,
    ) -> CredentialModelAccess | None:
        result = await self._db.execute(
            select(CredentialModelAccess).where(
                CredentialModelAccess.credential_id == credential_id,
                CredentialModelAccess.upstream_model_id == upstream_row_id,
            ),
        )
        return result.scalar_one_or_none()

    async def _has_usable_access(self, upstream_row_id: str) -> bool:
        result = await self._db.execute(
            select(func.count())
            .select_from(CredentialModelAccess)
            .join(Credential, Credential.id == CredentialModelAccess.credential_id)
            .where(
                CredentialModelAccess.upstream_model_id == upstream_row_id,
                CredentialModelAccess.status == "available",
                Credential.enabled == True,  # noqa: E712
                Credential.runtime_status.in_(("active", "unknown")),
            ),
        )
        return int(result.scalar_one()) > 0

    # ── Probe/lifecycle helpers ─────────────────────────────────────────────

    async def _activate_targets_after_probe(self, upstream: UpstreamModel, now: datetime) -> None:
        for target in await self._role_targets_for_upstream(upstream.id):
            entry = await self._entry_for_upstream(
                target.public_model_id,
                upstream.upstream_model_id,
            )
            if entry is None:
                # Desired state is the authority: a role-managed target without
                # a matching entry is stale history, not something a probe may
                # resurrect.
                continue
            if not entry.enabled:
                target.enabled = False
                self._set_lifecycle(target, "verified", "desired_disabled")
                continue
            target.enabled = True
            self._set_lifecycle(target, "active", "probe_success")
            target.updated_at = now

    @staticmethod
    def _set_lifecycle(target: RouteTarget, status: str, reason: str) -> None:
        if target.lifecycle_status != status or target.lifecycle_reason != reason:
            target.lifecycle_status = status
            target.lifecycle_reason = reason
            target.lifecycle_updated_at = _utcnow()

    @staticmethod
    def _probe_backoff_seconds(failures: int) -> int:
        exponent = min(max(0, failures - 1), 4)
        backoff = PROBE_BACKOFF_BASE_SECONDS * (2**exponent)
        return int(min(PROBE_BACKOFF_CAP_SECONDS, backoff))

    @staticmethod
    def _probe_failure_is_model_scoped(reason: str, probe_row: Mapping[str, Any]) -> bool:
        candidates = {reason}
        for key in ("errorCode", "error_code", "code"):
            value = probe_row.get(key)
            if isinstance(value, str):
                candidates.add(value)
        return bool(candidates & _MODEL_SCOPED_REASONS)

    @staticmethod
    def _merge_probe_capabilities(
        upstream: UpstreamModel,
        probe_row: Mapping[str, Any],
        now: datetime,
        *,
        success: bool,
    ) -> None:
        caps = dict(upstream.capabilities or {})
        caps["source"] = "probe"
        caps["verified_at"] = _utc_iso(now)
        caps["verification_status"] = "working" if success else "failed"
        latency = probe_row.get("latencyMs")
        if isinstance(latency, int) and not isinstance(latency, bool):
            caps["probe_latency_ms"] = latency
        upstream.capabilities = caps
        upstream.updated_at = now

    @staticmethod
    def _error_reason(error: Any) -> str:
        if isinstance(error, Mapping):
            code = error.get("error_code") or error.get("errorCode") or error.get("code")
            category = error.get("category") or error.get("reason")
        else:
            code = getattr(error, "error_code", None)
            category = getattr(error, "category", None)
        value = code or category or "unknown"
        return str(value)

    @staticmethod
    def _error_is_model_scoped(error: Any) -> bool:
        if isinstance(error, Mapping):
            explicit = error.get("is_model_specific", error.get("isModelSpecific"))
            category = error.get("category") or error.get("reason")
            code = error.get("error_code") or error.get("errorCode") or error.get("code")
        else:
            explicit = getattr(error, "is_model_specific", None)
            category = getattr(error, "category", None)
            code = getattr(error, "error_code", None)
        if explicit is not None:
            return bool(explicit)
        return bool(
            {str(category or ""), str(code or "")} & _MODEL_SCOPED_REASONS,
        )
