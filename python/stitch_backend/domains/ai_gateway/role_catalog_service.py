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

from stitch_backend.domains.ai_gateway.chain_refill_policy import (
    rotation_state,
    rotation_state_active,
)
from stitch_backend.domains.ai_gateway.model_evidence import derive_evidence_tier
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
# Live inventory truth, probed directly against ReformBoss upstream on
# 2026-11-26.  ``RETIRED_UPSTREAM_MODELS`` return ``model_not_found`` at the
# gateway — they are gone for every key class, so desired entries only cost
# probe budget and are kept out of the chains.  ``PROVEN_LIVE_MODELS`` answered
# exact probes with real completions; every chain must end with one of them so
# no role can go fully unroutable when upstream retires frontier models.
# Access-denied models (``token_model_not_allowed`` for the probing key class:
# gemini-4-carbon, qwen3.8-max, claude-fable-5-2) are per-key entitlement, not
# upstream death — they stay in chains backed by live tails, because other
# users' keys may be entitled, and exact-probe gating means they never activate
# (therefore never cost routing budget) for keys that are not.
RETIRED_UPSTREAM_MODELS = frozenset(
    {
        "kimi-k3",
        "glm-5.4",
        "gemini-4-argon",
        "deepseek-v4.1-flash-1017",
    }
)
PROVEN_LIVE_MODELS = frozenset(
    {
        "deepseek-v4-pro",
        "deepseek-v4.1-flash",
        "gpt-6-luna",
        "glm-5.3",
    }
)

DEFAULT_ROLE_CHAIN_SPECS: dict[str, tuple[RoleChainStep, ...]] = {
    "rb/lead": (
        ("gemini-4-carbon", "google"),
        ("deepseek-v4-pro", "deepseek"),
        ("glm-5.3", "zhipu"),
    ),
    "rb/planner": (
        ("gemini-4-carbon", "google"),
        ("deepseek-v4-pro", "deepseek"),
        ("gpt-6-luna", "openai"),
    ),
    "rb/researcher": (
        ("deepseek-v4-pro", "deepseek"),
        ("qwen3.8-max", "qwen"),
        ("glm-5.3", "zhipu"),
        ("gpt-6-luna", "openai"),
    ),
    "rb/builder": (
        ("glm-5.3", "zhipu"),
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
        ("gpt-6-luna", "openai"),
    ),
    "rb/reviewer-adversarial": (
        ("gpt-6-luna", "openai"),
        ("deepseek-v4-pro", "deepseek"),
        ("glm-5.3", "zhipu"),
    ),
    "rb/verifier": (
        ("deepseek-v4.1-flash", "deepseek"),
        ("gpt-6-luna", "openai"),
        ("glm-5.3", "zhipu"),
    ),
    "rb/small": (
        ("deepseek-v4.1-flash", "deepseek"),
        ("glm-5.3", "zhipu"),
    ),
}

# Per-role latency contracts informed by ReformBoss production reality.
# These thresholds are watchdog tripwires against *wedged* upstreams, not UX
# latency targets: failover ordering and latency-aware target selection
# already prefer fast models, so the watchdog's only job is to bound the
# worst case.  ReformBoss upstreams routinely show 15-25s TTFT during
# degraded/peak periods while still answering (measured live: glm-5.3 first
# token at 20.6s while healthy); the original 8-30s seeds aborted every
# attempt before first byte exactly when the upstream was slow-but-alive.
# ``stall`` is deliberately 2x TTFT: once a stream has started, brief
# upstream pauses are still tolerable for reasoning models, while a totally
# silent stream beyond roughly two TTFT budgets is treated as wedged.
# These are seeded operational defaults, not hidden constants: operators may
# tune them on the PublicModel contract, and reconciliation only fills
# absent keys.
DEFAULT_ROLE_LATENCY_MS: dict[str, tuple[int, int]] = {
    "rb/small": (25_000, 50_000),
    "rb/builder-fast": (30_000, 60_000),
    "rb/verifier": (30_000, 60_000),
    "rb/builder": (40_000, 80_000),
    "rb/lead": (45_000, 90_000),
    "rb/planner": (50_000, 100_000),
    "rb/reviewer-correctness": (50_000, 100_000),
    "rb/reviewer-adversarial": (50_000, 100_000),
    "rb/researcher": (50_000, 100_000),
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
        "public_models_updated": 0,
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
        self._routing_transitioned = False

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
        self._invalidate_resolve_caches_if_transitioned()
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
        self._invalidate_resolve_caches_if_transitioned()
        return stats

    async def reconcile_health(self) -> dict[str, int]:
        """Control-plane health sweep for already materialized role targets.

        This is passive-only: it demotes active role targets when no eligible
        ``available`` credential/model access row remains.  It never probes the
        network.  One narrow repair is allowed: a target previously demoted as
        ``no_usable_access`` may become active again when usable capacity is
        already evidenced by an ``available`` access row on a healthy credential
        (typically after credential-wide recovery).  That does not bypass exact
        probe activation — the access row is itself positive exact/manual probe
        evidence; model-failure demotions stay down until a fresh exact probe.
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
            has_usable = await self._has_usable_access(upstream.id)
            if has_usable:
                if (
                    entry is not None
                    and entry.enabled
                    and target.lifecycle_status == "demoted"
                    and target.lifecycle_reason == "no_usable_access"
                ):
                    self._enable_target(target, "active", "capacity_restored", _utcnow())
                    stats["route_targets_updated"] += 1
                continue
            if target.lifecycle_status != "active":
                continue
            self._disable_target(target, "demoted", "no_usable_access")
            stats["route_targets_updated"] += 1
        await self._db.flush()
        self._invalidate_resolve_caches_if_transitioned()
        return stats

    # ── Health evidence (implemented here; wired to workers/routing in Phase 3) ──

    async def note_upstream_outcome(
        self,
        *,
        endpoint_id: str,
        upstream_model_id: str,
        error: Any,
        credential_id: str | None = None,
    ) -> None:
        """Re-evaluate role targets after live traffic already updated access rows.

        ``upstream_model_id`` accepts the DB row id used by ``record_result``;
        as a convenience it also accepts the exact upstream model string.  Only
        model-scoped failures matter.  Demotion happens only when no usable
        ``available`` access row remains, preventing one bad key from flapping
        a model that other keys can still serve.

        Key-entitlement failures (``model_access_denied`` /
        ``token_model_not_allowed`` / ``provider_forbidden``) additionally
        escalate the failing pair's access row to terminal ``denied`` — the
        key simply has no entitlement to the model, so automation stops
        probing it (only manual revalidation may clear the mark).
        """
        if error is None or not self._error_is_model_scoped(error):
            return
        upstream = await self._resolve_upstream_reference(endpoint_id, upstream_model_id)
        if upstream is None:
            return
        reason = self._error_reason(error)
        now = _utcnow()
        if reason in _DENIED_REASONS and credential_id is not None:
            access = await self._access_row(credential_id, upstream.id)
            if access is not None and access.status != "denied":
                access.status = "denied"
                access.last_error = reason
                access.last_verified_at = now
                access.updated_at = now
                await self._db.flush()
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
                self._disable_target(target, "demoted", reason)
        await self._db.flush()
        self._invalidate_resolve_caches_if_transitioned()

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
            self._invalidate_resolve_caches_if_transitioned()
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

        # The probe evidences one exact (credential, model) pair.  Model-level
        # ``verification_status="failed"`` is justified only when that evidence
        # leaves no usable access path at all — the same condition as target
        # demotion.  While sibling keys still serve, a single-key entitlement
        # failure must not contaminate upstream-level metadata.
        has_usable = await self._has_usable_access(upstream.id)
        self._merge_probe_capabilities(
            upstream,
            probe_row,
            now,
            success=False,
            model_level_failure=not has_usable,
        )
        for target in await self._role_targets_for_upstream(upstream.id):
            if target.enabled and target.lifecycle_status == "active" and has_usable:
                continue
            self._disable_target(target, "demoted", reason)
        await self._db.flush()
        self._invalidate_resolve_caches_if_transitioned()

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

    async def role_routing_status(self) -> list[dict[str, Any]]:
        """Return rb/* desired chains joined with materialized runtime state.

        This is a read-only aggregation used by the operator UI.  Desired
        entries remain the ordering source of truth; runtime targets, endpoint
        circuit state and exact credential/model probe evidence are attached
        without changing either layer.  The method deliberately does not seed
        or reconcile anything: reconciliation is a write side effect and this
        method is served by a read-only command.
        """
        entries = await self.list_entries()
        present_role_ids = {entry.public_model_id for entry in entries}
        role_ids = [role for role in DEFAULT_ROLE_CHAIN_SPECS if role in present_role_ids]
        role_ids.extend(sorted(present_role_ids.difference(DEFAULT_ROLE_CHAIN_SPECS)))
        if not entries:
            return []

        endpoint_rows = list(
            (
                await self._db.execute(
                    select(ProviderEndpoint).order_by(
                        ProviderEndpoint.created_at.asc(),
                        ProviderEndpoint.id.asc(),
                    ),
                )
            ).scalars().all()
        )

        endpoints_by_selector: dict[str, ProviderEndpoint | None] = {}
        for selector in sorted({entry.endpoint_selector for entry in entries}):
            tagged = [
                row
                for row in endpoint_rows
                if isinstance(row.health_policy, dict)
                and row.health_policy.get("roleCatalog") == selector
            ]
            endpoint = tagged[0] if tagged else None
            if endpoint is None and selector == REFORMBOSS_ENDPOINT_SELECTOR:
                endpoint = next(
                    (
                        row
                        for row in endpoint_rows
                        if _normalized_base_url(row.base_url) == REFORMBOSS_BASE_URL
                    ),
                    None,
                )
            endpoints_by_selector[selector] = endpoint

        now = _utcnow()
        rotation_by_selector: dict[str, dict[str, Any]] = {}
        for selector, endpoint in endpoints_by_selector.items():
            if endpoint is None:
                continue
            rotation_raw = rotation_state(endpoint.health_policy)
            if rotation_raw is None:
                continue
            enriched = dict(rotation_raw)
            enriched["active"] = rotation_state_active(endpoint.health_policy, now)
            rotation_by_selector[selector] = enriched

        endpoint_ids = {
            endpoint.id for endpoint in endpoints_by_selector.values() if endpoint is not None
        }
        upstream_keys = {entry.upstream_model_key for entry in entries}
        upstream_rows: list[UpstreamModel] = []
        if endpoint_ids and upstream_keys:
            upstream_rows = list(
                (
                    await self._db.execute(
                        select(UpstreamModel).where(
                            UpstreamModel.provider_endpoint_id.in_(endpoint_ids),
                            UpstreamModel.upstream_model_id.in_(upstream_keys),
                        ),
                    )
                ).scalars().all()
            )
        upstream_by_key = {
            (row.provider_endpoint_id, row.upstream_model_id): row for row in upstream_rows
        }
        upstream_row_ids = [row.id for row in upstream_rows]

        target_rows: list[RouteTarget] = []
        if upstream_row_ids:
            target_rows = list(
                (
                    await self._db.execute(
                        select(RouteTarget).where(
                            RouteTarget.public_model_id.in_(role_ids),
                            RouteTarget.upstream_model_id.in_(upstream_row_ids),
                        ),
                    )
                ).scalars().all()
            )
        target_by_key = {
            (row.public_model_id, row.upstream_model_id): row for row in target_rows
        }

        access_summary: dict[str, dict[str, Any]] = {}
        if upstream_row_ids:
            access_rows = (
                await self._db.execute(
                    select(CredentialModelAccess, Credential)
                    .join(Credential, Credential.id == CredentialModelAccess.credential_id)
                    .where(CredentialModelAccess.upstream_model_id.in_(upstream_row_ids)),
                )
            ).all()
            for access_row, credential in access_rows:
                summary = access_summary.setdefault(
                    access_row.upstream_model_id,
                    {
                        "available": 0,
                        "denied": 0,
                        "temporarily_unavailable": 0,
                        "unknown": 0,
                        "next_probe_at": None,
                        "last_verified_at": None,
                    },
                )
                if (
                    access_row.status == "available"
                    and credential.enabled
                    and credential.runtime_status == "active"
                ):
                    summary["available"] += 1
                elif access_row.status == "denied":
                    summary["denied"] += 1
                elif access_row.status == "temporarily_unavailable":
                    summary["temporarily_unavailable"] += 1
                else:
                    summary["unknown"] += 1

                if access_row.next_probe_at is not None and (
                    summary["next_probe_at"] is None
                    or access_row.next_probe_at < summary["next_probe_at"]
                ):
                    summary["next_probe_at"] = access_row.next_probe_at
                if access_row.last_verified_at is not None and (
                    summary["last_verified_at"] is None
                    or access_row.last_verified_at > summary["last_verified_at"]
                ):
                    summary["last_verified_at"] = access_row.last_verified_at

        public_rows = list(
            (
                await self._db.execute(select(PublicModel).where(PublicModel.id.in_(role_ids)))
            ).scalars().all()
        )
        public_by_id = {row.id: row for row in public_rows}
        entries_by_role: dict[str, list[RoleChainEntry]] = {
            role_id: [] for role_id in role_ids
        }
        for entry in entries:
            entries_by_role.setdefault(entry.public_model_id, []).append(entry)

        def empty_access() -> dict[str, Any]:
            return {
                "available": 0,
                "denied": 0,
                "temporarily_unavailable": 0,
                "unknown": 0,
                "next_probe_at": None,
                "last_verified_at": None,
            }

        roles: list[dict[str, Any]] = []
        for role_id in role_ids:
            steps: list[dict[str, Any]] = []
            for entry in sorted(
                entries_by_role.get(role_id, []),
                key=lambda row: (row.ordinal, row.upstream_model_key),
            ):
                endpoint = endpoints_by_selector.get(entry.endpoint_selector)
                upstream = (
                    upstream_by_key.get((endpoint.id, entry.upstream_model_key))
                    if endpoint is not None
                    else None
                )
                target = (
                    target_by_key.get((entry.public_model_id, upstream.id))
                    if upstream is not None
                    else None
                )
                access = dict(access_summary.get(upstream.id, empty_access())) if upstream else empty_access()

                if not entry.enabled:
                    state = "disabled"
                elif endpoint is None or upstream is None or target is None:
                    state = "missing"
                elif not endpoint.enabled or not upstream.enabled:
                    state = "disabled"
                elif target.lifecycle_status == "demoted":
                    state = "demoted"
                elif target.enabled and target.lifecycle_status == "active":
                    state = "active"
                elif (
                    target.managed_by == "manual"
                    or target.lifecycle_reason == "manual_override"
                    or (target.lifecycle_status == "verified" and not target.enabled)
                ):
                    state = "manual"
                else:
                    # ``quarantined``/``discovered``/NULL all mean the exact
                    # probe path has not produced positive evidence yet.
                    state = "probing"

                steps.append(
                    {
                        "entry_id": entry.id,
                        "ordinal": entry.ordinal,
                        "desired_enabled": entry.enabled,
                        "source": entry.source,
                        "endpoint_selector": entry.endpoint_selector,
                        "upstream_model_key": entry.upstream_model_key,
                        "family": entry.family,
                        "endpoint_id": endpoint.id if endpoint else None,
                        "endpoint_name": endpoint.name if endpoint else None,
                        "endpoint_base_url": endpoint.base_url if endpoint else None,
                        "endpoint_enabled": endpoint.enabled if endpoint else None,
                        "endpoint_circuit_state": endpoint.circuit_state if endpoint else None,
                        "upstream_row_id": upstream.id if upstream else None,
                        "upstream_enabled": upstream.enabled if upstream else None,
                        "route_target_id": target.id if target else None,
                        "route_enabled": target.enabled if target else None,
                        "priority": target.priority if target else None,
                        "managed_by": target.managed_by if target else None,
                        "lifecycle_status": target.lifecycle_status if target else None,
                        "lifecycle_reason": target.lifecycle_reason if target else None,
                        "lifecycle_updated_at": target.lifecycle_updated_at if target else None,
                        "state": state,
                        "is_current": False,
                        "access": access,
                    },
                )

            current_index = next(
                (index for index, step in enumerate(steps) if step["state"] == "active"),
                None,
            )
            if current_index is not None:
                steps[current_index]["is_current"] = True

            active_steps = sum(1 for step in steps if step["state"] == "active")
            probing_steps = sum(1 for step in steps if step["state"] == "probing")
            demoted_steps = sum(1 for step in steps if step["state"] == "demoted")
            missing_steps = sum(1 for step in steps if step["state"] == "missing")
            public = public_by_id.get(role_id)
            role_enabled = bool(public.enabled) if public is not None else False
            first_desired_index = next(
                (index for index, step in enumerate(steps) if step["desired_enabled"]),
                None,
            )
            first_active_index = next(
                (index for index, step in enumerate(steps) if step["state"] == "active"),
                None,
            )
            if not role_enabled:
                role_state = "disabled"
            elif first_active_index is not None and first_active_index == first_desired_index:
                role_state = "active"
            elif active_steps > 0:
                # The role can serve, but only because a lower-priority fallback
                # step is carrying it.
                role_state = "degraded"
            elif probing_steps > 0:
                role_state = "probing"
            elif demoted_steps > 0:
                role_state = "demoted"
            elif missing_steps > 0:
                role_state = "missing"
            else:
                role_state = "disabled"

            role_rotation_states = [
                rotation_by_selector[selector]
                for selector in sorted(
                    {entry.endpoint_selector for entry in entries_by_role.get(role_id, [])}
                )
                if selector in rotation_by_selector
            ]
            rotation = next(
                (state for state in role_rotation_states if state.get("active") is True),
                role_rotation_states[0] if role_rotation_states else None,
            )

            roles.append(
                {
                    "id": role_id,
                    "display_name": public.display_name if public else role_id,
                    "enabled": role_enabled,
                    "contract": public.contract if public else None,
                    "state": role_state,
                    "rotation_detected": bool(rotation and rotation.get("active") is True),
                    "rotation": rotation,
                    "total_steps": len(steps),
                    "active_steps": active_steps,
                    "probing_steps": probing_steps,
                    "demoted_steps": demoted_steps,
                    "steps": steps,
                },
            )

        return roles

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
        if updates.get("enabled") is False and target.lifecycle_status == "active":
            # A manually disabled target is definitionally not active runtime
            # state.  Keep it verified (not demoted/quarantined): this was an
            # operator choice, not negative health evidence.
            target.lifecycle_status = "verified"
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
        if target.enabled:
            self._routing_transitioned = True
        target.enabled = False
        target.lifecycle_reason = reason
        target.lifecycle_updated_at = _utcnow()
        await self._db.flush()
        self._invalidate_resolve_caches_if_transitioned()

    # ── Catalog seeding ─────────────────────────────────────────────────────

    async def _seed_catalog(self, stats: dict[str, int]) -> set[str]:
        conflicts = await self._ensure_role_public_models(stats)
        stats["conflicts"] += len(conflicts)
        await self._seed_default_entries(conflicts, stats)
        return conflicts

    async def _ensure_role_public_models(self, stats: dict[str, int]) -> set[str]:
        conflicts: set[str] = set()
        for role in DEFAULT_ROLE_CHAIN_SPECS:
            contract = self._default_role_contract(role)
            public = await self._db.get(PublicModel, role)
            if public is None:
                self._db.add(
                    PublicModel(
                        id=role,
                        display_name=role,
                        enabled=True,
                        owner_id=None,
                        contract=contract,
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
                continue
            if self._patch_role_latency_contract(public, role):
                stats["public_models_updated"] += 1
                # Cached routing results embed the public-model contract; a
                # patched latency policy must reach the watchdog without a
                # process restart even though no target enabled flag flipped.
                self._routing_transitioned = True
        await self._db.flush()
        return conflicts

    @staticmethod
    def _default_role_contract(role: str) -> dict[str, dict[str, int]]:
        max_ttft, stall = DEFAULT_ROLE_LATENCY_MS[role]
        return {"latency": {"maxTtftMs": max_ttft, "stallTimeoutMs": stall}}

    @staticmethod
    def _patch_role_latency_contract(public: PublicModel, role: str) -> bool:
        """Add missing automation-owned latency keys to an existing role row.

        Merge semantics are deliberately conservative: automation fills only
        absent keys and never overwrites a key already present in the operator-
        visible contract.  Other top-level/nested contract keys are preserved.
        A non-dict ``latency`` value is treated as operator-owned (albeit
        malformed) and left untouched rather than clobbered.
        """
        max_ttft, stall = DEFAULT_ROLE_LATENCY_MS[role]
        contract = dict(public.contract or {})
        raw_latency = contract.get("latency")
        if raw_latency is None:
            latency: dict[str, Any] = {}
        elif isinstance(raw_latency, dict):
            latency = dict(raw_latency)
        else:
            return False

        changed = False
        if "maxTtftMs" not in latency:
            latency["maxTtftMs"] = max_ttft
            changed = True
        if "stallTimeoutMs" not in latency:
            latency["stallTimeoutMs"] = stall
            changed = True
        if not changed:
            return False
        contract["latency"] = latency
        public.contract = contract
        public.updated_at = _utcnow()
        return True

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
                if row.source in ("manual", "auto"):
                    # Manual rows are operator-owned; auto rows belong to the
                    # refill writer.  Factory seeds must neither rewrite nor
                    # resurrect either writer's rows.
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
            if row.source in ("manual", "auto") or key in valid_keys:
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
            self._disable_target(target, "quarantined", "desired_unverified")
            changed = True
        elif target.lifecycle_status == "verified":
            self._enable_target(target, "active", "desired_reenabled", now)
            changed = True
        elif target.lifecycle_status == "active":
            if not target.enabled:
                self._enable_target(target, "active", target.lifecycle_reason or "active", now)
                changed = True
        elif target.enabled:
            self._disable_target(target, target.lifecycle_status or "quarantined", target.lifecycle_reason or "desired_unverified")
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
            self._routing_transitioned = True
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

    @staticmethod
    def _endpoint_matches(endpoint: ProviderEndpoint) -> bool:
        return RoleCatalogService._endpoint_is_tagged(endpoint) or (
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

    def _disable_target(self, target: RouteTarget, status: str, reason: str) -> None:
        """Disable *target* and set its lifecycle, tracking routing-visible flips."""
        if target.enabled:
            target.enabled = False
            self._routing_transitioned = True
        self._set_lifecycle(target, status, reason)

    def _enable_target(self, target: RouteTarget, status: str, reason: str, now: datetime) -> None:
        """Enable *target* and set its lifecycle, tracking routing-visible flips."""
        if not target.enabled:
            target.enabled = True
            self._routing_transitioned = True
        self._set_lifecycle(target, status, reason)
        target.updated_at = now

    def _invalidate_resolve_caches_if_transitioned(self) -> None:
        """Drop route-resolution caches when a target enabled flag flipped.

        ``RouteTarget.enabled`` is authoritative routing input, but the
        generic cache-invalidation events do not cover target mutations, so
        role-catalog lifecycle transitions must invalidate explicitly.
        Lazy import avoids the ``routing_engine → service → role_catalog``
        module cycle.
        """
        if not self._routing_transitioned:
            return
        self._routing_transitioned = False
        from stitch_backend.domains.ai_gateway.routing_engine import (
            invalidate_resolve_caches,
        )
        invalidate_resolve_caches()

    async def _activate_targets_after_probe(self, upstream: UpstreamModel, now: datetime) -> None:
        caps = dict(upstream.capabilities or {})
        if not upstream.enabled and caps.get("retired_auto") is True:
            # A successful exact probe is positive evidence for this exact
            # upstream model.  Re-enable only rows retired by catalog rotation;
            # a probe must never override an operator's manual disable.
            upstream.enabled = True
            caps.pop("retired_auto", None)
            upstream.capabilities = caps
            upstream.updated_at = now
            self._routing_transitioned = True
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
                self._disable_target(target, "verified", "desired_disabled")
                continue
            self._enable_target(target, "active", "probe_success", now)

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
        model_level_failure: bool = True,
    ) -> None:
        caps = dict(upstream.capabilities or {})
        caps["source"] = "probe"
        caps["verified_at"] = _utc_iso(now)
        caps["probed_at"] = _utc_iso(now)
        caps.pop("probe_timed_out", None)
        reason = str(probe_row.get("reason") or "")
        error_code = str(probe_row.get("errorCode") or probe_row.get("error_code") or "")
        if success:
            caps["verification_status"] = "working"
            caps.pop("verification_reason", None)
            caps.pop("verification_error_code", None)
            caps["coherence_passed"] = True
            # A fresh coherent probe clears model-death stickiness.  Key-scoped
            # entitlement failures never write that marker in the first place.
            caps.pop("last_model_failure_at", None)
        elif model_level_failure:
            caps["verification_status"] = "failed"
            if reason:
                caps["verification_reason"] = reason
            if error_code:
                caps["verification_error_code"] = error_code
            if reason not in _DENIED_REASONS and error_code not in _DENIED_REASONS:
                caps["last_model_failure_at"] = _utc_iso(now)
        # A pair-scoped failure while sibling credentials still serve is not
        # upstream-model evidence: preserve any prior verification status.
        if not success and {reason, error_code} & {"empty_completion", "canary_mismatch"}:
            # These are negative semantic evidence, unlike access/transport
            # failures.  They erase tier eligibility until a future coherent
            # probe re-establishes it.
            caps["coherence_passed"] = False
            caps.pop("evidence_tier", None)
            caps["emergency_tail"] = False
        latency = probe_row.get("latencyMs")
        if isinstance(latency, int) and not isinstance(latency, bool):
            caps["probe_latency_ms"] = latency
        usage_sane = probe_row.get("usageSane")
        if isinstance(usage_sane, bool):
            caps["usage_sane"] = usage_sane
        usage_reason = probe_row.get("usageReason")
        if isinstance(usage_reason, str) and usage_reason:
            caps["usage_reason"] = usage_reason
        level2_passed = probe_row.get("level2Passed")
        if isinstance(level2_passed, bool):
            caps["level2_passed"] = level2_passed
        coherence = caps.get("coherence_passed") is True
        tier = derive_evidence_tier(
            coherence_passed=coherence,
            level2_passed=caps.get("level2_passed") if isinstance(caps.get("level2_passed"), bool) else None,
            latency_ms=caps.get("probe_latency_ms") if isinstance(caps.get("probe_latency_ms"), int) else None,
            usage_sane=caps.get("usage_sane") if isinstance(caps.get("usage_sane"), bool) else None,
        )
        if coherence and tier is not None:
            caps["evidence_tier"] = tier
            caps["emergency_tail"] = tier == "emergency_tail"
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
