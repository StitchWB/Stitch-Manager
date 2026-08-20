"""AI Gateway routing engine — capability-aware request routing.

Resolves a public model ID to a concrete (endpoint, credential, upstream model)
triple, applying capability filtering, circuit-breaker checks, and priority/
weight-based selection.

This is the single entry point the executor should call instead of the
current wildcard LiteLLM deployment selection.

Pool routing (Wave-2)
---------------------
``RoutingEngine.route(session, request, pool)`` and
``get_available_public_models(session, pool)`` take a :class:`PoolScope`
that defines which credentials/public models the caller may see:

  - ``owner_user_id``: the caller's user id (``None`` for desktop / auth-disabled).
  - ``group_ids``: groups the caller is a member of (empty for desktop).
  - ``include_instance_shared``: whether NULL-owner (instance-shared) rows
    are visible (default ``True`` — preserves the legacy desktop pool).

The pool predicate is ``(owner_id == uid OR owner_id IS NULL OR cgs.group_id IN groups)``
applied as a single prefetch grouped by ``upstream_model_id``; per-target
filtering happens in memory (no per-target DB query).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, false, func, or_, select
from sqlalchemy.orm import aliased

from stitch_backend.domains.ai_gateway import circuit_breaker, credential_state
from stitch_backend.domains.ai_gateway.adapters.base import (
    ClassifiedError,
    ProviderAdapter,
    get_adapter,
)
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialGroupShare,
    CredentialModelAccess,
    ProviderEndpoint,
    PublicModel,
    RouteTarget,
    UpstreamModel,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialService,
    PublicModelService,
    RouteTargetService,
    UpstreamModelService,
)

# NOTE: ``Group`` and ``GroupUsage`` are NOT imported at top level — that
# would re-create the ``ai_gateway → groups`` import edge we just cut.
# They are lazy-imported inside ``_over_quota_group_ids`` (the only
# function that reads quota) so the only remaining dependency edge is
# ``groups → ai_gateway`` (one-way).

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3


# ═══════════════════════════════════════════════════════════════════════════
# Pool scope
# ═══════════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class PoolScope:
    """Which credentials/public models a caller may route against.

    ``owner_user_id`` is the caller's user id (``None`` for desktop /
    auth-disabled installs).  ``group_ids`` is the tuple of groups the
    caller is a member of (empty for desktop).  ``include_instance_shared``
    controls whether NULL-owner (instance-shared) rows are visible —
    defaults to ``True`` to preserve the legacy desktop pool.
    """

    owner_user_id: int | None
    group_ids: tuple[str, ...] = ()
    include_instance_shared: bool = True


# ═══════════════════════════════════════════════════════════════════════════
# Request / result types
# ═══════════════════════════════════════════════════════════════════════════


@dataclass
class GatewayRequest:
    """Minimal request shape the routing engine needs."""

    model: str  # public model ID
    messages: list[dict[str, Any]] = field(default_factory=list)
    stream: bool = False
    tools: list[dict[str, Any]] | None = None
    response_format: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        if not self.model or not isinstance(self.model, str):
            raise ValueError("model must be a non-empty string")
        if not isinstance(self.messages, list):
            raise ValueError("messages must be a list")


@dataclass
class RoutingResult:
    """Everything the executor needs to make the upstream call."""

    endpoint: ProviderEndpoint
    credential: Credential
    upstream_model: UpstreamModel
    adapter: ProviderAdapter
    secret: str = field(repr=False)
    default_headers: dict[str, str]
    group_id_hit: str | None = None
    """Share row that made the credential visible (``None`` via owner/instance-shared)."""


class RoutingError(Exception):
    """Raised when no valid route can be found."""


# ═══════════════════════════════════════════════════════════════════════════
# Capability derivation
# ═══════════════════════════════════════════════════════════════════════════


def derive_requirements(request: GatewayRequest) -> dict[str, bool]:
    """Infer capability requirements from request content."""
    reqs: dict[str, bool] = {
        "vision": False,
        "tools": False,
        "json_mode": False,
        "streaming": request.stream,
    }

    # Check messages for image content.
    for msg in request.messages:
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    reqs["vision"] = True
                    break
        if reqs["vision"]:
            break

    if request.tools:
        reqs["tools"] = True

    rf = request.response_format
    if isinstance(rf, dict) and rf.get("type") == "json_schema":
        reqs["json_mode"] = True

    return reqs


def _model_satisfies(capabilities: dict[str, Any] | None, requirements: dict[str, bool]) -> bool:
    """Check if an upstream model's capabilities satisfy the request requirements."""
    if not capabilities:
        # No capability data — assume it can handle anything (optimistic).
        return True

    cap_map = {
        "vision": capabilities.get("supports_vision"),
        "tools": capabilities.get("supports_function_calling") or capabilities.get("supports_tools"),
        "json_mode": capabilities.get("supports_json_mode") or capabilities.get("supports_json_schema"),
        "streaming": capabilities.get("supports_streaming"),
    }

    for req_key, required in requirements.items():
        if not required:
            continue
        cap_val = cap_map.get(req_key)
        # None/unknown = assume yes (optimistic), False = reject.
        if cap_val is False:
            return False

    return True


# ═══════════════════════════════════════════════════════════════════════════
# Routing engine
# ═══════════════════════════════════════════════════════════════════════════


class RoutingEngine:
    """Capability-aware request router for the AI Gateway."""

    async def route(
        self,
        session: AsyncSession,
        request: GatewayRequest,
        pool: PoolScope | None = None,
    ) -> list[RoutingResult]:
        """Resolve a public model to a list of (endpoint, credential, upstream) candidates.

        Returns candidates ordered by priority/weight, with each candidate
        having an eligible credential. The executor should try candidates in
        order and fall back to the next if the first fails.

        Args:
            pool: Pool scope for the caller. When ``None``, defaults to
                ``PoolScope(None, (), True)`` (desktop / auth-disabled) —
                preserves the legacy behavior of routing over instance-shared
                (NULL-owner) rows only.

        Raises:
            RoutingError: if no valid route exists.
        """
        if pool is None:
            pool = PoolScope(owner_user_id=None)

        # 1. Resolve public model.
        pub_svc = PublicModelService(session)
        public_model = await pub_svc.get_by_pk(request.model)
        if public_model is None or not public_model.enabled:
            raise RoutingError(f"Public model {request.model!r} not found or disabled")

        # 2. Derive requirements.
        requirements = derive_requirements(request)

        # 3. Get route targets (ordered by priority ASC, weight DESC).
        target_svc = RouteTargetService(session)
        targets = await target_svc.list_targets_for_public_model(public_model.id)
        enabled_targets = [t for t in targets if t.enabled]
        if not enabled_targets:
            raise RoutingError(f"No enabled route targets for {request.model!r}")

        # 4. Filter by capability.
        model_svc = UpstreamModelService(session)
        candidates: list[tuple[RouteTarget, UpstreamModel]] = []
        for target in enabled_targets:
            upstream = await model_svc.get_by_pk(target.upstream_model_id)
            if upstream is None or not upstream.enabled:
                continue
            if not _model_satisfies(upstream.capabilities, requirements):
                continue
            candidates.append((target, upstream))

        if not candidates:
            raise RoutingError(
                f"No route targets satisfy requirements {requirements} for {request.model!r}",
            )

        # 5. ONE prefetch: eligible credentials grouped by upstream_model_id.
        # The pool predicate (owner_id == uid OR owner_id IS NULL OR
        # cgs.group_id IN groups) is applied here, plus the existing
        # enabled/runtime_status/cooldown/endpoint filters. Per-target
        # filtering happens in memory (no per-target DB query).
        now = _utcnow()
        upstream_ids = [u.id for _t, u in candidates]
        cred_rows = await _fetch_pool_credentials(
            session, pool, upstream_ids,
        )

        # 5b. Quota-aware filtering: when the caller is a real user with
        # group memberships, exclude credentials whose only visibility is
        # via over-quota groups.  Credentials owned by the caller or
        # instance-shared (group_id_hit is None) stay eligible.
        over_quota = await _over_quota_group_ids(session, pool)
        if over_quota:
            cred_rows = [
                (uid_, cred, gid)
                for uid_, cred, gid in cred_rows
                if gid is None or gid not in over_quota
            ]

        # cred_rows: list[(upstream_model_id, Credential, group_id_hit)]
        # Index by upstream_model_id for in-memory per-target lookup.
        creds_by_upstream: dict[str, list[tuple[Credential, str | None]]] = {}
        for upstream_id, cred, group_id_hit in cred_rows:
            creds_by_upstream.setdefault(upstream_id, []).append((cred, group_id_hit))

        # 6. Per-target in-memory filtering + selection.
        cred_svc = CredentialService(session)
        results: list[RoutingResult] = []

        for _target, upstream in candidates:
            eligible = creds_by_upstream.get(upstream.id, [])
            # Filter out credentials in cooldown (next_retry_at > now).
            eligible = [
                (c, gid) for c, gid in eligible
                if c.next_retry_at is None or c.next_retry_at <= now
            ]
            eligible_creds_only = [c for c, _ in eligible]
            if not eligible_creds_only:
                continue

            # 7. Check endpoint circuit breaker.
            if not await circuit_breaker.is_endpoint_available(
                session, upstream.provider_endpoint_id,
            ):
                continue

            # 8. Select credential (round-robin via least-recently-used).
            cred = min(
                eligible_creds_only,
                key=lambda c: c.last_success_at or datetime.min.replace(tzinfo=UTC),
            )
            # Find the group_id_hit for the selected credential (attribution).
            group_id_hit = next(
                (gid for c, gid in eligible if c.id == cred.id), None,
            )

            # 9. Get endpoint, secret, adapter.
            from stitch_backend.domains.ai_gateway.service import ProviderEndpointService
            ep_svc = ProviderEndpointService(session)
            endpoint = await ep_svc.get_by_pk(upstream.provider_endpoint_id)
            if endpoint is None:
                continue

            secret = await cred_svc.get_secret_for_invocation(cred.id)
            if not secret:
                continue

            try:
                adapter = get_adapter(endpoint.adapter_type)
            except KeyError:
                logger.warning(
                    "RoutingEngine: no adapter registered for endpoint %s "
                    "(adapter_type=%r) — skipping candidate",
                    endpoint.id, endpoint.adapter_type,
                )
                continue

            # Attribution: log caller uid, credential_id, owner_id, group_id_hit.
            logger.info(
                "RoutingEngine route: caller_uid=%s credential=%s owner_id=%s group_id_hit=%s",
                pool.owner_user_id, cred.id, cred.owner_id, group_id_hit,
            )

            results.append(RoutingResult(
                endpoint=endpoint,
                credential=cred,
                upstream_model=upstream,
                adapter=adapter,
                secret=secret,
                default_headers=endpoint.default_headers or {},
                group_id_hit=group_id_hit,
            ))

        if not results:
            raise RoutingError(f"No eligible credentials found for {request.model!r}")

        return results

    async def record_result(
        self,
        session: AsyncSession,
        credential_id: str,
        endpoint_id: str,
        error: ClassifiedError | None,
        http_status: int | None,
    ) -> None:
        """Record the outcome of a routed request — updates credential state and circuit breaker."""
        await credential_state.transition_credential(
            session, credential_id, error, http_status,
        )
        await circuit_breaker.record_endpoint_result(
            session, endpoint_id, success=(error is None),
        )

    async def get_available_public_models(
        self,
        session: AsyncSession,
        pool: PoolScope | None = None,
    ) -> list[PublicModel]:
        """Return all enabled public models visible to *pool* (for /v1/models).

        Applies the same pool predicate as :meth:`route` — fixes the prior
        bug where ``owner_id=None`` saw ONLY NULL rows (per-user public
        models were invisible).
        """
        if pool is None:
            pool = PoolScope(owner_user_id=None)

        stmt = select(PublicModel)
        where_clauses = [_pool_predicate_for_public_model(pool)]
        stmt = stmt.where(and_(*where_clauses))
        result = await session.execute(stmt)
        all_models = list(result.scalars().all())
        return [m for m in all_models if m.enabled]


# ═══════════════════════════════════════════════════════════════════════════
# Pool predicate helpers
# ═══════════════════════════════════════════════════════════════════════════


async def _over_quota_group_ids(
    session: AsyncSession,
    pool: PoolScope,
) -> set[str]:
    """Return the set of group ids where the caller has exceeded the
    per-member daily request cap.

    No-op (returns ``set()``) when the caller is ``None`` (desktop) or has
    no group memberships.  A single query joins ``groups`` with today's
    ``group_usage`` row for the caller; a group is over-quota when
    ``max_requests_per_member_daily`` is not NULL and today's usage is
    already >= the cap.
    """
    uid = pool.owner_user_id
    if uid is None or not pool.group_ids:
        return set()
    # Lazy import — avoids a top-level ``ai_gateway → groups`` edge.
    from stitch_backend.domains.groups.models import Group, GroupUsage

    today = datetime.now(UTC).strftime("%Y-%m-%d")
    stmt = (
        select(
            Group.id,
            Group.max_requests_per_member_daily,
            func.coalesce(GroupUsage.requests, 0).label("requests"),
        )
        .outerjoin(
            GroupUsage,
            and_(
                GroupUsage.group_id == Group.id,
                GroupUsage.user_id == uid,
                GroupUsage.day == today,
            ),
        )
        .where(
            Group.id.in_(list(pool.group_ids)),
            Group.max_requests_per_member_daily.is_not(None),
        )
    )
    result = await session.execute(stmt)
    over: set[str] = set()
    for row in result.all():
        cap = row.max_requests_per_member_daily
        if cap is not None and int(row.requests) >= int(cap):
            over.add(row.id)
    return over


def _pool_predicate_for_credentials(
    pool: PoolScope,
    c_model,
    cgs_alias,
):
    """WHERE predicate for Credential rows visible to *pool*.

    ``(c.owner_id == uid OR (include_instance_shared AND c.owner_id IS NULL)
    OR cgs.group_id IN groups)``.  When ``owner_user_id`` is ``None``
    (desktop), the owner clause is omitted — only ``include_instance_shared``
    controls NULL-owner visibility.
    """
    clauses = []
    if pool.owner_user_id is not None:
        clauses.append(c_model.owner_id == pool.owner_user_id)
    if pool.include_instance_shared:
        clauses.append(c_model.owner_id.is_(None))
    if pool.group_ids:
        clauses.append(cgs_alias.group_id.in_(list(pool.group_ids)))
    return or_(*clauses) if clauses else false()


def _pool_predicate_for_public_model(pool: PoolScope):
    """WHERE predicate for PublicModel rows visible to *pool*."""
    clauses = []
    if pool.owner_user_id is not None:
        clauses.append(PublicModel.owner_id == pool.owner_user_id)
    if pool.include_instance_shared:
        clauses.append(PublicModel.owner_id.is_(None))
    return or_(*clauses) if clauses else false()


async def _fetch_pool_credentials(
    session: AsyncSession,
    pool: PoolScope,
    upstream_ids: list[str],
) -> list[tuple[str, Credential, str | None]]:
    """ONE prefetch: eligible credentials grouped by upstream_model_id.

    Returns a list of ``(upstream_model_id, Credential, group_id_hit)`` tuples
    where ``group_id_hit`` is the share row that made the credential visible
    (``None`` when visible via owner_id or instance-shared).

    Applies the pool predicate + existing enabled/runtime_status filters.
    """
    if not upstream_ids:
        return []

    cgs_alias = aliased(CredentialGroupShare)
    stmt = (
        select(
            CredentialModelAccess.upstream_model_id,
            Credential,
            cgs_alias.group_id.label("group_id_hit"),
        )
        .select_from(Credential)
        .join(
            CredentialModelAccess,
            CredentialModelAccess.credential_id == Credential.id,
        )
        .outerjoin(
            cgs_alias,
            and_(
                cgs_alias.credential_id == Credential.id,
                *(
                    [cgs_alias.group_id.in_(list(pool.group_ids))]
                    if pool.group_ids
                    else []
                ),
            ),
        )
        .where(
            CredentialModelAccess.upstream_model_id.in_(upstream_ids),
            CredentialModelAccess.status == "available",
            Credential.enabled == True,  # noqa: E712
            Credential.runtime_status.in_(("active", "unknown")),
            _pool_predicate_for_credentials(pool, Credential, cgs_alias),
        )
    )
    result = await session.execute(stmt)
    return [
        (row.upstream_model_id, row.Credential, row.group_id_hit)
        for row in result.all()
    ]
