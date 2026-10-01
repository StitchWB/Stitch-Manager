"""UpstreamModel CRUD commands."""

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
from stitch_backend.domains.ai_gateway.models import ProviderEndpoint
from stitch_backend.domains.ai_gateway.schemas import (
    ListUpstreamModelsRequest,
    UpstreamModelCreateRequest,
    UpstreamModelIdRequest,
    UpstreamModelResponse,
    UpstreamModelUpdateRequest,
)
from stitch_backend.domains.ai_gateway.service import UpstreamModelService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@command("create_upstream_model")
async def cmd_create_upstream_model(db: AsyncSession, params: dict) -> Any:
    """Create (or idempotently update) an upstream model row.

    Delegates to ``UpstreamModelService.upsert_model`` — calling this
    command twice with the same ``(providerEndpointId, upstreamModelId)``
    updates the existing row rather than creating a duplicate.
    """
    req = UpstreamModelCreateRequest.model_validate(params)
    owner_id = _caller_uid(params)

    ep_result = await db.execute(
        select(ProviderEndpoint).where(
            and_(
                ProviderEndpoint.id == req.provider_endpoint_id,
                _owner_filter(ProviderEndpoint, owner_id),
            )
        )
    )
    if ep_result.scalar_one_or_none() is None:
        raise StitchError(
            f"Provider endpoint not found: {req.provider_endpoint_id}"
        )
    svc = UpstreamModelService(db)
    model = await svc.upsert_model(
        req.provider_endpoint_id,
        req.upstream_model_id,
        display_name=req.display_name,
        enabled=req.enabled,
        discovery_source=req.discovery_source,
        capabilities=req.capabilities,
    )
    return UpstreamModelResponse.from_orm_model(model)


@command("list_upstream_models", readonly=True)
async def cmd_list_upstream_models(db: AsyncSession, params: dict) -> Any:
    req = ListUpstreamModelsRequest.model_validate(params)

    svc = UpstreamModelService(db)
    models = await svc.list_models(req.provider_endpoint_id)
    return [UpstreamModelResponse.from_orm_model(m) for m in models]


@command("get_upstream_model", readonly=True)
async def cmd_get_upstream_model(db: AsyncSession, params: dict) -> Any:
    req = UpstreamModelIdRequest.model_validate(params)

    svc = UpstreamModelService(db)
    model = await svc.get_by_pk(req.id)
    return UpstreamModelResponse.from_orm_model(model) if model else None


@command("update_upstream_model")
async def cmd_update_upstream_model(db: AsyncSession, params: dict) -> Any:
    req = UpstreamModelUpdateRequest.model_validate(params)
    updates = req.model_dump(exclude={"id"}, exclude_none=True)
    owner_id = _caller_uid(params)

    model = await UpstreamModelService(db).get_by_pk(req.id)
    if model is None:
        return None
    ep_result = await db.execute(
        select(ProviderEndpoint).where(
            and_(
                ProviderEndpoint.id == model.provider_endpoint_id,
                _owner_filter(ProviderEndpoint, owner_id),
            )
        )
    )
    if ep_result.scalar_one_or_none() is None:
        return None
    svc = UpstreamModelService(db)
    updated = await svc.update_by_pk(req.id, **updates)
    return UpstreamModelResponse.from_orm_model(updated) if updated else None


@register_command("delete_upstream_model")
async def cmd_delete_upstream_model(params: dict) -> dict:
    req = UpstreamModelIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        # IDOR guard — the parent endpoint must pass _owner_filter before deletion.
        model = await UpstreamModelService(session).get_by_pk(req.id)
        if model is None:
            return False
        ep_result = await session.execute(
            select(ProviderEndpoint).where(
                and_(
                    ProviderEndpoint.id == model.provider_endpoint_id,
                    _owner_filter(ProviderEndpoint, owner_id),
                )
            )
        )
        if ep_result.scalar_one_or_none() is None:
            return False
        svc = UpstreamModelService(session)
        return await svc.delete_by_pk(req.id)

    deleted = await run_in_session(_op)
    return {"success": deleted}
