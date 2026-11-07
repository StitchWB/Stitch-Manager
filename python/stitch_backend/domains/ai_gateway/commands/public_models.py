"""PublicModel CRUD commands."""

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
from stitch_backend.domains.ai_gateway.models import PublicModel, _utcnow
from stitch_backend.domains.ai_gateway.schemas import (
    MergePublicModelsRequest,
    PublicModelCreateRequest,
    PublicModelIdRequest,
    PublicModelResponse,
    PublicModelUpdateRequest,
    UnmergeRouteTargetRequest,
)
from stitch_backend.domains.ai_gateway.service import (
    PublicModelService,
    RouteTargetService,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@command("create_public_model")
async def cmd_create_public_model(db: AsyncSession, params: dict) -> Any:
    req = PublicModelCreateRequest.model_validate(params)
    owner_id = _caller_uid(params)

    svc = PublicModelService(db)
    model = await svc.create_public_model(
        req.id,
        display_name=req.display_name,
        enabled=req.enabled,
        contract=req.contract,
        owner_id=owner_id,
    )
    return PublicModelResponse.from_orm_model(model)


@command("list_public_models", readonly=True)
async def cmd_list_public_models(db: AsyncSession, params: dict) -> Any:
    owner_id = _caller_uid(params)

    svc = PublicModelService(db)
    models = await svc.list_public_models(owner_id=owner_id)
    return [PublicModelResponse.from_orm_model(m) for m in models]


@command("get_public_model", readonly=True)
async def cmd_get_public_model(db: AsyncSession, params: dict) -> Any:
    req = PublicModelIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    result = await db.execute(
        select(PublicModel).where(
            and_(
                PublicModel.id == req.id,
                _owner_filter(PublicModel, owner_id),
            )
        )
    )
    model = result.scalar_one_or_none()
    return PublicModelResponse.from_orm_model(model) if model else None


@command("update_public_model")
async def cmd_update_public_model(db: AsyncSession, params: dict) -> Any:
    req = PublicModelUpdateRequest.model_validate(params)
    updates = req.model_dump(exclude={"id"}, exclude_none=True)
    owner_id = _caller_uid(params)

    result = await db.execute(
        select(PublicModel).where(
            and_(
                PublicModel.id == req.id,
                _owner_filter(PublicModel, owner_id),
            )
        )
    )
    model = result.scalar_one_or_none()
    if model is None:
        return None
    for key, value in updates.items():
        if hasattr(model, key):
            setattr(model, key, value)
    if hasattr(model, "updated_at"):
        model.updated_at = _utcnow()
    await db.flush()
    await db.refresh(model)
    return PublicModelResponse.from_orm_model(model)


@register_command("delete_public_model")
async def cmd_delete_public_model(params: dict) -> dict:
    req = PublicModelIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        result = await session.execute(
            select(PublicModel).where(
                and_(
                    PublicModel.id == req.id,
                    _owner_filter(PublicModel, owner_id),
                )
            )
        )
        model = result.scalar_one_or_none()
        if model is None:
            return False
        await session.delete(model)
        await session.flush()
        return True

    deleted = await run_in_session(_op)
    return {"success": deleted}


@command("merge_public_models")
async def cmd_merge_public_models(db: AsyncSession, params: dict) -> Any:
    """Fold ``sourceId`` into ``targetId``: move its route targets, then delete it."""
    req = MergePublicModelsRequest.model_validate(params)
    owner_id = _caller_uid(params)
    if req.source_id == req.target_id:
        raise StitchError("Cannot merge a public model into itself")

    async def _load(model_id: str) -> PublicModel | None:
        result = await db.execute(
            select(PublicModel).where(
                and_(
                    PublicModel.id == model_id,
                    _owner_filter(PublicModel, owner_id),
                )
            )
        )
        return result.scalar_one_or_none()

    source = await _load(req.source_id)
    target = await _load(req.target_id)
    if source is None:
        raise StitchError(f"Public model not found: {req.source_id}")
    if target is None:
        raise StitchError(f"Public model not found: {req.target_id}")

    target_svc = RouteTargetService(db)
    target_upstream_ids = {
        t.upstream_model_id
        for t in await target_svc.list_targets_for_public_model(target.id)
    }
    for route in await target_svc.list_targets_for_public_model(source.id):
        if route.upstream_model_id in target_upstream_ids:
            await db.delete(route)
        else:
            route.public_model_id = target.id
            route.updated_at = _utcnow()
    await db.delete(source)
    await db.flush()
    await db.refresh(target)
    return PublicModelResponse.from_orm_model(target)


@command("unmerge_route_target")
async def cmd_unmerge_route_target(db: AsyncSession, params: dict) -> Any:
    """Split one route target into its own public model (created if missing)."""
    req = UnmergeRouteTargetRequest.model_validate(params)
    owner_id = _caller_uid(params)

    target = await RouteTargetService(db).get_by_pk(req.target_id)
    if target is None:
        raise StitchError(f"Route target not found: {req.target_id}")
    pm_result = await db.execute(
        select(PublicModel).where(
            and_(
                PublicModel.id == target.public_model_id,
                _owner_filter(PublicModel, owner_id),
            )
        )
    )
    if pm_result.scalar_one_or_none() is None:
        raise StitchError(f"Public model not found: {target.public_model_id}")

    pub_svc = PublicModelService(db)
    new_public = await pub_svc.get_by_pk(req.new_public_model_id)
    if new_public is None:
        new_public = await pub_svc.create_public_model(
            req.new_public_model_id,
            display_name=req.new_public_model_id,
            enabled=True,
            owner_id=owner_id,
        )

    existing = await RouteTargetService(db).list_targets_for_public_model(new_public.id)
    if any(t.upstream_model_id == target.upstream_model_id for t in existing):
        await db.delete(target)
    else:
        target.public_model_id = new_public.id
        target.updated_at = _utcnow()
    await db.flush()
    await db.refresh(new_public)
    return PublicModelResponse.from_orm_model(new_public)
