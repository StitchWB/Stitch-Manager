"""Credential CRUD commands (incl. secret rotation)."""

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
    Credential,
    CredentialGroupShare,
    ProviderEndpoint,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.schemas import (
    CredentialCreateRequest,
    CredentialIdRequest,
    CredentialResponse,
    CredentialUpdateRequest,
    ListCredentialsRequest,
    RotateCredentialSecretRequest,
)
from stitch_backend.domains.ai_gateway.service import CredentialService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@command("create_credential")
async def cmd_create_credential(db: AsyncSession, params: dict) -> Any:
    req = CredentialCreateRequest.model_validate(params)
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
    svc = CredentialService(db)
    credential = await svc.create_credential(
        provider_endpoint_id=req.provider_endpoint_id,
        label=req.label,
        auth_type=req.auth_type,
        secret=req.secret,
        owner_id=owner_id,
    )
    return CredentialResponse.from_orm_model(credential)


@command("list_credentials", readonly=True)
async def cmd_list_credentials(db: AsyncSession, params: dict) -> Any:
    """List credentials visible to the caller with shared-group scope info.

    Single LEFT JOIN aggregate to ``credential_group_shares`` + ``groups``
    populates ``owner_id`` / ``shared_group_ids`` / ``shared_group_names``
    on each item — no N+1.
    """
    req = ListCredentialsRequest.model_validate(params)
    owner_id = _caller_uid(params)

    from stitch_backend.domains.groups.models import Group

    stmt = (
        select(Credential, Group.id, Group.name)
        .select_from(Credential)
        .outerjoin(
            CredentialGroupShare,
            CredentialGroupShare.credential_id == Credential.id,
        )
        .outerjoin(Group, Group.id == CredentialGroupShare.group_id)
        .where(_owner_filter(Credential, owner_id))
        .order_by(Credential.created_at.desc())
    )
    if req.provider_endpoint_id is not None:
        stmt = stmt.where(
            Credential.provider_endpoint_id == req.provider_endpoint_id
        )
    result = await db.execute(stmt)

    # Aggregate: one entry per credential, group ids/names collected.
    cred_map: dict[str, Credential] = {}
    group_ids_map: dict[str, list[str]] = {}
    group_names_map: dict[str, list[str]] = {}
    for cred, gid, gname in result.all():
        if cred.id not in cred_map:
            cred_map[cred.id] = cred
            group_ids_map[cred.id] = []
            group_names_map[cred.id] = []
        if gid is not None:
            group_ids_map[cred.id].append(gid)
            group_names_map[cred.id].append(gname)

    return [
        CredentialResponse.from_orm_model(
            cred_map[cid],
            shared_group_ids=group_ids_map[cid],
            shared_group_names=group_names_map[cid],
        )
        for cid in cred_map
    ]


@command("get_credential", readonly=True)
async def cmd_get_credential(db: AsyncSession, params: dict) -> Any:
    req = CredentialIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    result = await db.execute(
        select(Credential).where(
            and_(
                Credential.id == req.id,
                _owner_filter(Credential, owner_id),
            )
        )
    )
    credential = result.scalar_one_or_none()
    return CredentialResponse.from_orm_model(credential) if credential else None


@command("update_credential")
async def cmd_update_credential(db: AsyncSession, params: dict) -> Any:
    """Update label/enabled only — secret rotation is NOT accepted here.

    Use ``rotate_credential_secret`` for secret changes.
    """
    req = CredentialUpdateRequest.model_validate(params)
    updates = req.model_dump(exclude={"id"}, exclude_none=True)
    owner_id = _caller_uid(params)

    result = await db.execute(
        select(Credential).where(
            and_(
                Credential.id == req.id,
                _owner_filter(Credential, owner_id),
            )
        )
    )
    credential = result.scalar_one_or_none()
    if credential is None:
        return None
    for key, value in updates.items():
        if hasattr(credential, key):
            setattr(credential, key, value)
    if hasattr(credential, "updated_at"):
        credential.updated_at = _utcnow()
    await db.flush()
    await db.refresh(credential)
    return CredentialResponse.from_orm_model(credential)


@command("rotate_credential_secret")
async def cmd_rotate_credential_secret(db: AsyncSession, params: dict) -> Any:
    """Rotate the raw secret for a credential.

    Updates the linked ``CredentialSecret``, recomputes the credential's
    fingerprint, and resets ``runtime_status`` to ``"unknown"``. The raw
    secret is never returned in the response.
    """
    req = RotateCredentialSecretRequest.model_validate(params)
    owner_id = _caller_uid(params)

    result = await db.execute(
        select(Credential).where(
            and_(
                Credential.id == req.id,
                _owner_filter(Credential, owner_id),
            )
        )
    )
    if result.scalar_one_or_none() is None:
        return None
    svc = CredentialService(db)
    credential = await svc.rotate_secret(req.id, req.new_secret)
    return CredentialResponse.from_orm_model(credential) if credential else None


@register_command("delete_credential")
async def cmd_delete_credential(params: dict) -> dict:
    req = CredentialIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        result = await session.execute(
            select(Credential).where(
                and_(
                    Credential.id == req.id,
                    _owner_filter(Credential, owner_id),
                )
            )
        )
        credential = result.scalar_one_or_none()
        if credential is None:
            return False
        await session.delete(credential)
        await session.flush()
        return True

    deleted = await run_in_session(_op)
    return {"success": deleted}
