"""Operator commands for role-chain desired state."""

from __future__ import annotations

from typing import TYPE_CHECKING

from stitch_backend.core.command_decorator import command
from stitch_backend.domains.ai_gateway.role_catalog_service import RoleCatalogService
from stitch_backend.domains.ai_gateway.schemas import (
    ListRoleChainEntriesRequest,
    RoleChainEntryIdRequest,
    RoleChainEntryResponse,
    UpsertRoleChainEntryRequest,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@command("list_role_chain_entries", readonly=True, request=ListRoleChainEntriesRequest)
async def cmd_list_role_chain_entries(
    db: AsyncSession,
    req: ListRoleChainEntriesRequest,
) -> list[RoleChainEntryResponse]:
    rows = await RoleCatalogService(db).list_entries(
        public_model_id=req.public_model_id,
        endpoint_selector=req.endpoint_selector,
    )
    return [RoleChainEntryResponse.from_orm_model(row) for row in rows]


@command("upsert_role_chain_entry", request=UpsertRoleChainEntryRequest)
async def cmd_upsert_role_chain_entry(
    db: AsyncSession,
    req: UpsertRoleChainEntryRequest,
) -> RoleChainEntryResponse:
    svc = RoleCatalogService(db)
    row = await svc.upsert_entry(
        public_model_id=req.public_model_id,
        endpoint_selector=req.endpoint_selector,
        upstream_model_key=req.upstream_model_key,
        family=req.family,
        ordinal=req.ordinal,
        enabled=req.enabled,
    )
    # Manual rows are authoritative but still materialize through the same
    # single path as factory defaults.
    await svc.reconcile_all()
    return RoleChainEntryResponse.from_orm_model(row)


@command("disable_role_chain_entry", request=RoleChainEntryIdRequest)
async def cmd_disable_role_chain_entry(
    db: AsyncSession,
    req: RoleChainEntryIdRequest,
) -> RoleChainEntryResponse | None:
    svc = RoleCatalogService(db)
    row = await svc.disable_entry(req.id)
    if row is None:
        return None
    await svc.reconcile_all()
    return RoleChainEntryResponse.from_orm_model(row)


@command("reset_role_chain_entry_to_default", request=RoleChainEntryIdRequest)
async def cmd_reset_role_chain_entry_to_default(
    db: AsyncSession,
    req: RoleChainEntryIdRequest,
) -> RoleChainEntryResponse | None:
    svc = RoleCatalogService(db)
    row = await svc.reset_entry_to_default(req.id)
    if row is None:
        return None
    await svc.reconcile_all()
    return RoleChainEntryResponse.from_orm_model(row)
