"""ProviderEndpoint CRUD commands."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, select

from stitch_backend.core.command_decorator import command
from stitch_backend.core.command_registry import register_command
from stitch_backend.core.event_bus import event_bus
from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway.commands._common import (
    _caller_uid,
    _owner_filter,
)
from stitch_backend.domains.ai_gateway.models import ProviderEndpoint, _utcnow
from stitch_backend.domains.ai_gateway.schemas import (
    ProviderEndpointCreateRequest,
    ProviderEndpointIdRequest,
    ProviderEndpointResponse,
    ProviderEndpointUpdateRequest,
)
from stitch_backend.domains.ai_gateway.service import ProviderEndpointService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def _reconcile_role_catalog_best_effort(
    db: AsyncSession,
    endpoint: ProviderEndpoint,
) -> None:
    """Materialize rb/* roles immediately after endpoint create/update.

    Reconciliation is local desired-state work (no network), so running it in
    the command's already-open transaction avoids both the discovery-interval
    delay and the fire-and-forget race where a background task reads before
    this command commits.  It is still strictly best-effort: endpoint CRUD must
    never fail because role automation did.
    """
    try:
        from stitch_backend.domains.ai_gateway.role_catalog_service import (
            RoleCatalogService,
        )

        async with db.begin_nested():
            await RoleCatalogService(db).reconcile_endpoint(endpoint)
    except Exception:
        logger.warning(
            "Role catalog reconcile failed for endpoint %s",
            getattr(endpoint, "id", "<new>"),
            exc_info=True,
        )


@command("create_provider_endpoint")
async def cmd_create_provider_endpoint(db: AsyncSession, params: dict) -> Any:
    req = ProviderEndpointCreateRequest.model_validate(params)
    owner_id = _caller_uid(params)

    svc = ProviderEndpointService(db)
    endpoint = await svc.create_endpoint(
        name=req.name,
        adapter_type=req.adapter_type,
        base_url=req.base_url,
        enabled=req.enabled,
        auto_publish_models=req.auto_publish_models,
        default_headers=req.default_headers,
        discovery_policy=req.discovery_policy,
        health_policy=req.health_policy,
        owner_id=owner_id,
    )
    await _reconcile_role_catalog_best_effort(db, endpoint)
    return ProviderEndpointResponse.from_orm_model(endpoint)


@command("list_provider_endpoints", readonly=True)
async def cmd_list_provider_endpoints(db: AsyncSession, params: dict) -> Any:
    """List configured provider endpoints (id, name, adapter, base URL)."""
    owner_id = _caller_uid(params)

    svc = ProviderEndpointService(db)
    endpoints = await svc.list_endpoints(owner_id=owner_id)
    return [ProviderEndpointResponse.from_orm_model(e) for e in endpoints]


@command("get_provider_endpoint", readonly=True)
async def cmd_get_provider_endpoint(db: AsyncSession, params: dict) -> Any:
    req = ProviderEndpointIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    result = await db.execute(
        select(ProviderEndpoint).where(
            and_(
                ProviderEndpoint.id == req.id,
                _owner_filter(ProviderEndpoint, owner_id),
            )
        )
    )
    endpoint = result.scalar_one_or_none()
    return ProviderEndpointResponse.from_orm_model(endpoint) if endpoint else None


@command("update_provider_endpoint")
async def cmd_update_provider_endpoint(db: AsyncSession, params: dict) -> Any:
    req = ProviderEndpointUpdateRequest.model_validate(params)
    updates = req.model_dump(exclude={"id"}, exclude_none=True)
    owner_id = _caller_uid(params)

    result = await db.execute(
        select(ProviderEndpoint).where(
            and_(
                ProviderEndpoint.id == req.id,
                _owner_filter(ProviderEndpoint, owner_id),
            )
        )
    )
    endpoint = result.scalar_one_or_none()
    if endpoint is None:
        return None
    for key, value in updates.items():
        if hasattr(endpoint, key):
            setattr(endpoint, key, value)
    if hasattr(endpoint, "updated_at"):
        endpoint.updated_at = _utcnow()
    await db.flush()
    await db.refresh(endpoint)
    await _reconcile_role_catalog_best_effort(db, endpoint)
    if "enabled" in updates:
        await event_bus.emit("endpoint.models_changed", {"endpoint_ids": [endpoint.id]})
    return ProviderEndpointResponse.from_orm_model(endpoint)


@register_command("delete_provider_endpoint")
async def cmd_delete_provider_endpoint(params: dict) -> dict:
    req = ProviderEndpointIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        result = await session.execute(
            select(ProviderEndpoint).where(
                and_(
                    ProviderEndpoint.id == req.id,
                    _owner_filter(ProviderEndpoint, owner_id),
                )
            )
        )
        endpoint = result.scalar_one_or_none()
        if endpoint is None:
            return False
        await session.delete(endpoint)
        await session.flush()
        return True

    deleted = await run_in_session(_op)
    return {"success": deleted}
