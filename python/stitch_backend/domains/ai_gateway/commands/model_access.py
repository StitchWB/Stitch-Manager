"""CredentialModelAccess commands."""

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
from stitch_backend.domains.ai_gateway.models import Credential, CredentialModelAccess
from stitch_backend.domains.ai_gateway.schemas import (
    CredentialModelAccessIdRequest,
    CredentialModelAccessResponse,
    CredentialModelAccessUpsertRequest,
    ListCredentialModelAccessRequest,
)
from stitch_backend.domains.ai_gateway.service import CredentialModelAccessService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@command("upsert_credential_model_access")
async def cmd_upsert_credential_model_access(db: AsyncSession, params: dict) -> Any:
    req = CredentialModelAccessUpsertRequest.model_validate(params)
    owner_id = _caller_uid(params)

    result = await db.execute(
        select(Credential).where(
            and_(
                Credential.id == req.credential_id,
                _owner_filter(Credential, owner_id),
            )
        )
    )
    if result.scalar_one_or_none() is None:
        return None
    svc = CredentialModelAccessService(db)
    existing_rows = await svc.list_access(req.credential_id, req.upstream_model_id)
    existing = existing_rows[0] if existing_rows else None
    # ``upsert_access`` mutates and returns the same ORM instance, so snapshot
    # the pre-write values before calling it; comparing object attributes
    # afterwards would always report "unchanged".
    previous = (
        (existing.status, existing.last_error) if existing is not None else None
    )
    access = await svc.upsert_access(
        req.credential_id,
        req.upstream_model_id,
        status=req.status,
        last_error=req.last_error,
    )
    changed = previous != (access.status, access.last_error)
    if changed:
        from stitch_backend.domains.ai_gateway.routing_engine import (
            invalidate_resolve_caches,
        )
        invalidate_resolve_caches()
    return CredentialModelAccessResponse.from_orm_model(access)


@command("list_credential_model_access", readonly=True)
async def cmd_list_credential_model_access(db: AsyncSession, params: dict) -> Any:
    req = ListCredentialModelAccessRequest.model_validate(params)

    svc = CredentialModelAccessService(db)
    rows = await svc.list_access(req.credential_id, req.upstream_model_id)
    return [CredentialModelAccessResponse.from_orm_model(r) for r in rows]


@register_command("delete_credential_model_access")
async def cmd_delete_credential_model_access(params: dict) -> dict:
    req = CredentialModelAccessIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        # IDOR guard — the referenced credential must pass _owner_filter before deletion.
        cred_result = await session.execute(
            select(CredentialModelAccess).where(
                CredentialModelAccess.id == req.id
            )
        )
        access = cred_result.scalar_one_or_none()
        if access is None:
            return False
        owner_result = await session.execute(
            select(Credential).where(
                and_(
                    Credential.id == access.credential_id,
                    _owner_filter(Credential, owner_id),
                )
            )
        )
        if owner_result.scalar_one_or_none() is None:
            return False
        svc = CredentialModelAccessService(session)
        return await svc.delete_by_pk(req.id)

    deleted = await run_in_session(_op)
    if deleted:
        from stitch_backend.domains.ai_gateway.routing_engine import (
            invalidate_resolve_caches,
        )
        invalidate_resolve_caches()
    return {"success": deleted}
