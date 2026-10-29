"""PublicModel CRUD commands."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, select

from stitch_backend.core.command_decorator import command
from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway.commands._common import (
    _caller_uid,
    _owner_filter,
)
from stitch_backend.domains.ai_gateway.models import PublicModel, _utcnow
from stitch_backend.domains.ai_gateway.schemas import (
    PublicModelCreateRequest,
    PublicModelIdRequest,
    PublicModelResponse,
    PublicModelUpdateRequest,
)
from stitch_backend.domains.ai_gateway.service import PublicModelService

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
