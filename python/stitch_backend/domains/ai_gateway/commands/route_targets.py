"""RouteTarget CRUD commands."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, select

from stitch_backend.core.command_decorator import command
from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway.commands._common import (
    _caller_uid,
    _owner_filter,
)
from stitch_backend.domains.ai_gateway.models import (
    ProviderEndpoint,
    PublicModel,
    UpstreamModel,
)
from stitch_backend.domains.ai_gateway.role_catalog_service import (
    ROLE_MANAGED_BY,
    RoleCatalogService,
)
from stitch_backend.domains.ai_gateway.routing_engine import (
    invalidate_resolve_caches,
)
from stitch_backend.domains.ai_gateway.schemas import (
    ListRouteTargetsForPublicModelRequest,
    RouteTargetCreateRequest,
    RouteTargetIdRequest,
    RouteTargetResponse,
    RouteTargetUpdateRequest,
)
from stitch_backend.domains.ai_gateway.service import RouteTargetService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@command("create_route_target")
async def cmd_create_route_target(db: AsyncSession, params: dict) -> Any:
    req = RouteTargetCreateRequest.model_validate(params)
    owner_id = _caller_uid(params)

    pm_result = await db.execute(
        select(PublicModel).where(
            and_(
                PublicModel.id == req.public_model_id,
                _owner_filter(PublicModel, owner_id),
            )
        )
    )
    if pm_result.scalar_one_or_none() is None:
        raise StitchError(
            f"Public model not found: {req.public_model_id}"
        )
    # IDOR guard — the upstream model's parent endpoint must pass _owner_filter.
    um_result = await db.execute(
        select(UpstreamModel).where(
            UpstreamModel.id == req.upstream_model_id
        )
    )
    upstream_model = um_result.scalar_one_or_none()
    if upstream_model is None:
        raise StitchError(
            f"Upstream model not found: {req.upstream_model_id}"
        )
    ep_result = await db.execute(
        select(ProviderEndpoint).where(
            and_(
                ProviderEndpoint.id == upstream_model.provider_endpoint_id,
                _owner_filter(ProviderEndpoint, owner_id),
            )
        )
    )
    if ep_result.scalar_one_or_none() is None:
        raise StitchError(
            f"Provider endpoint not found: {upstream_model.provider_endpoint_id}"
        )
    svc = RouteTargetService(db)
    target = await svc.create_target(
        req.public_model_id,
        req.upstream_model_id,
        enabled=req.enabled,
        priority=req.priority,
        weight=req.weight,
        cost_modifier=req.cost_modifier,
    )
    # RouteTarget rows are authoritative routing input; the resolve cache has
    # no TTL, so every mutation must drop cached resolutions explicitly.
    invalidate_resolve_caches()
    return RouteTargetResponse.from_orm_model(target)


@command("list_route_targets_for_public_model", readonly=True)
async def cmd_list_route_targets_for_public_model(db: AsyncSession, params: dict) -> Any:
    req = ListRouteTargetsForPublicModelRequest.model_validate(params)

    svc = RouteTargetService(db)
    targets = await svc.list_targets_for_public_model(req.public_model_id)
    return [RouteTargetResponse.from_orm_model(t) for t in targets]


@command("get_route_target", readonly=True)
async def cmd_get_route_target(db: AsyncSession, params: dict) -> Any:
    req = RouteTargetIdRequest.model_validate(params)

    svc = RouteTargetService(db)
    target = await svc.get_by_pk(req.id)
    return RouteTargetResponse.from_orm_model(target) if target else None


@command("update_route_target")
async def cmd_update_route_target(db: AsyncSession, params: dict) -> Any:
    req = RouteTargetUpdateRequest.model_validate(params)
    updates = req.model_dump(exclude={"id"}, exclude_none=True)
    owner_id = _caller_uid(params)

    target = await RouteTargetService(db).get_by_pk(req.id)
    if target is None:
        return None
    pm_result = await db.execute(
        select(PublicModel).where(
            and_(
                PublicModel.id == target.public_model_id,
                _owner_filter(PublicModel, owner_id),
            )
        )
    )
    if pm_result.scalar_one_or_none() is None:
        return None
    if target.managed_by == ROLE_MANAGED_BY:
        # A generic operator edit is an explicit manual override.  Record it
        # in desired state and detach the materialized row from automation;
        # otherwise the next role reconcile would silently revert the edit.
        await RoleCatalogService(db).mark_target_manual_override(target, updates)
    svc = RouteTargetService(db)
    updated = await svc.update_by_pk(req.id, **updates)
    invalidate_resolve_caches()
    return RouteTargetResponse.from_orm_model(updated) if updated else None


@register_command("delete_route_target")
async def cmd_delete_route_target(params: dict) -> dict:
    req = RouteTargetIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        # IDOR guard — the parent public model must pass _owner_filter before deletion.
        target = await RouteTargetService(session).get_by_pk(req.id)
        if target is None:
            return False
        pm_result = await session.execute(
            select(PublicModel).where(
                and_(
                    PublicModel.id == target.public_model_id,
                    _owner_filter(PublicModel, owner_id),
                )
            )
        )
        if pm_result.scalar_one_or_none() is None:
            return False
        if target.managed_by == ROLE_MANAGED_BY:
            # Role-managed targets are materialized history, not independent
            # rows.  Deleting one means "remove this desired chain entry":
            # tombstone the entry so reconciliation cannot resurrect it, and
            # disable the runtime target without erasing its history.
            await RoleCatalogService(session).disable_entry_for_target(target)
            return True
        svc = RouteTargetService(session)
        return await svc.delete_by_pk(req.id)

    deleted = await run_in_session(_op)
    if deleted:
        invalidate_resolve_caches()
    return {"success": deleted}
