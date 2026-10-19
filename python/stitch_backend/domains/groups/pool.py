"""Credential pool sharing within groups."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import and_, delete, select

from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialGroupShare,
    ProviderEndpoint,
)
from stitch_backend.domains.ai_gateway.service import CredentialService
from stitch_backend.domains.auth.models import User
from stitch_backend.domains.groups.membership import get_group, is_member
from stitch_backend.domains.groups.models import _utcnow

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


def mask_secret(secret: str) -> str:
    """Mask a secret: first4+****+last4.  Short secrets → ****."""
    if len(secret) < 8:
        return "****"
    return secret[:4] + "****" + secret[-4:]


async def _fetch_masked_secret(db: AsyncSession, credential_id: str) -> str:
    """Fetch the secret via the sanctioned path and return masked.

    Uses ``CredentialService.get_secret_for_invocation`` — the ONLY
    sanctioned path for raw secret access.  The raw value never leaves
    this function; only the masked version is returned.
    """
    svc = CredentialService(db)
    secret = await svc.get_secret_for_invocation(credential_id)
    if not secret:
        return ""
    return mask_secret(secret)


async def share_credential(
    db: AsyncSession,
    credential_id: str,
    group_id: str,
    uid: int | None,
) -> bool:
    """Credential owner shares to a group they're a member of; idempotent."""
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")

    cred_result = await db.execute(
        select(Credential).where(Credential.id == credential_id)
    )
    credential = cred_result.scalar_one_or_none()
    if credential is None:
        raise StitchError("Credential not found")

    if uid is not None:
        if credential.owner_id != uid:
            raise StitchError("Only the credential owner can share it")
        if not await is_member(db, group_id, uid):
            raise StitchError("Not a member of this group")

    existing_result = await db.execute(
        select(CredentialGroupShare).where(
            and_(
                CredentialGroupShare.credential_id == credential_id,
                CredentialGroupShare.group_id == group_id,
            )
        )
    )
    if existing_result.scalar_one_or_none() is not None:
        return True

    share = CredentialGroupShare(
        credential_id=credential_id,
        group_id=group_id,
        created_at=_utcnow(),
    )
    db.add(share)
    await db.flush()
    return True


async def unshare_credential(
    db: AsyncSession,
    credential_id: str,
    group_id: str,
    uid: int | None,
) -> bool:
    """Credential owner OR group owner unshares; idempotent."""
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")

    cred_result = await db.execute(
        select(Credential).where(Credential.id == credential_id)
    )
    credential = cred_result.scalar_one_or_none()
    if credential is None:
        raise StitchError("Credential not found")

    if uid is not None:
        is_cred_owner = credential.owner_id == uid
        is_group_owner = group.owner_id == uid
        if not (is_cred_owner or is_group_owner):
            raise StitchError(
                "Only the credential owner or group owner can unshare"
            )

    await db.execute(
        delete(CredentialGroupShare).where(
            and_(
                CredentialGroupShare.credential_id == credential_id,
                CredentialGroupShare.group_id == group_id,
            )
        )
    )
    await db.flush()
    return True


async def list_pool(
    db: AsyncSession, group_id: str, uid: int | None
) -> list[dict]:
    """Members-only pool list with masked secrets and permission flags.

    Single eager query joins Credential + endpoint + owner username +
    shares.  ``masked_secret`` is computed server-side via
    ``get_secret_for_invocation`` inside the mask helper — raw secret
    never appears in the response.
    """
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if not await is_member(db, group_id, uid):
        raise StitchError("Not a member of this group")

    stmt = (
        select(
            Credential.id,
            Credential.label,
            Credential.runtime_status,
            Credential.enabled,
            Credential.created_at,
            Credential.owner_id,
            ProviderEndpoint.name.label("endpoint_name"),
            ProviderEndpoint.adapter_type,
            User.username.label("contributor_username"),
        )
        .select_from(Credential)
        .join(
            CredentialGroupShare,
            CredentialGroupShare.credential_id == Credential.id,
        )
        .join(
            ProviderEndpoint,
            Credential.provider_endpoint_id == ProviderEndpoint.id,
        )
        .outerjoin(User, Credential.owner_id == User.id)
        .where(CredentialGroupShare.group_id == group_id)
        .order_by(Credential.created_at.desc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    items: list[dict] = []
    for row in rows:
        can_manage = uid is not None and row.owner_id == uid
        can_unshare = can_manage or (
            uid is not None and group.owner_id == uid
        )
        masked = await _fetch_masked_secret(db, row.id)
        items.append(
            {
                "credential_id": row.id,
                "label": row.label,
                "endpoint_name": row.endpoint_name,
                "adapter_type": row.adapter_type,
                "runtime_status": row.runtime_status,
                "enabled": row.enabled,
                "contributor_username": row.contributor_username,
                "masked_secret": masked,
                "can_manage": can_manage,
                "can_unshare": can_unshare,
                "created_at": row.created_at,
            }
        )
    return items
