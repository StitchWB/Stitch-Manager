"""Groups domain service — membership helpers + all group operations.

Wave-2 (pool routing) imports the membership helpers:
  - ``group_ids_for_user(db, uid) -> list[str]``
  - ``is_member(db, group_id, uid) -> bool``
  - ``get_group(db, group_id) -> Group | None``
  - ``normalize_username(username) -> str``

All functions take ``db: AsyncSession`` as the first argument and use
``await db.flush()`` (never ``commit()``) — the caller commits via
``run_in_session()``.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import and_, delete, func, select
from sqlalchemy.orm import aliased

from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialGroupShare,
    ProviderEndpoint,
)
from stitch_backend.domains.ai_gateway.service import CredentialService
from stitch_backend.domains.auth.models import User
from stitch_backend.domains.groups.models import (
    Group,
    GroupInvite,
    GroupMember,
    GroupUsage,
    _utcnow,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

MAX_GROUPS_PER_OWNER = 3
MAX_MEMBERS_PER_GROUP = 10


# ── Username normalization ───────────────────────────────────────────────────


def normalize_username(username: str) -> str:
    """Normalize a username for invite matching: strip '@', lower."""
    return (username or "").strip().lstrip("@").lower()


# ── Secret masking ───────────────────────────────────────────────────────────


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


# ── Wave-2 membership helpers ─────────────────────────────────────────────────


async def group_ids_for_user(db: AsyncSession, uid: int | None) -> list[str]:
    """Return the list of group IDs the user is a member of."""
    if uid is None:
        return []
    result = await db.execute(
        select(GroupMember.group_id).where(GroupMember.user_id == uid)
    )
    return [row[0] for row in result.all()]


async def is_member(db: AsyncSession, group_id: str, uid: int | None) -> bool:
    """True when *uid* is a member of *group_id*."""
    if uid is None:
        return False
    result = await db.execute(
        select(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.user_id == uid,
            )
        )
    )
    return result.scalar_one_or_none() is not None


async def get_group(db: AsyncSession, group_id: str) -> Group | None:
    """Return the Group row or None."""
    result = await db.execute(select(Group).where(Group.id == group_id))
    return result.scalar_one_or_none()


# ── Group operations ───────────────────────────────────────────────────────────


async def create_group(
    db: AsyncSession, *, name: str, owner_id: int | None
) -> Group:
    """Create a group; owner becomes owner-member.

    Caps at ``MAX_GROUPS_PER_OWNER`` groups where the caller is owner.
    """
    if owner_id is None:
        raise StitchError("Authentication required to create a group")

    count_result = await db.execute(
        select(func.count())
        .select_from(Group)
        .where(Group.owner_id == owner_id)
    )
    if int(count_result.scalar_one()) >= MAX_GROUPS_PER_OWNER:
        raise StitchError(
            f"Maximum of {MAX_GROUPS_PER_OWNER} groups per owner"
        )

    group = Group(
        name=name,
        owner_id=owner_id,
        created_at=_utcnow(),
    )
    db.add(group)
    await db.flush()

    member = GroupMember(
        group_id=group.id,
        user_id=owner_id,
        role="owner",
        joined_at=_utcnow(),
    )
    db.add(member)
    await db.flush()
    return group


async def list_groups_for_user(
    db: AsyncSession, uid: int | None, username: str | None
) -> dict:
    """Return groups where uid is a member + pending invites for username."""
    if uid is None:
        return {"groups": [], "invites": []}

    my_membership = aliased(GroupMember)
    all_members = aliased(GroupMember)

    groups_stmt = (
        select(
            Group.id,
            Group.name,
            my_membership.role,
            func.count(func.distinct(all_members.user_id)).label("member_count"),
            func.count(
                func.distinct(CredentialGroupShare.credential_id)
            ).label("key_count"),
            Group.created_at,
        )
        .select_from(Group)
        .join(
            my_membership,
            and_(
                my_membership.group_id == Group.id,
                my_membership.user_id == uid,
            ),
        )
        .outerjoin(all_members, all_members.group_id == Group.id)
        .outerjoin(
            CredentialGroupShare,
            CredentialGroupShare.group_id == Group.id,
        )
        .group_by(
            Group.id, Group.name, my_membership.role, Group.created_at
        )
        .order_by(Group.created_at.desc())
    )
    groups_result = await db.execute(groups_stmt)
    groups = [
        {
            "id": row.id,
            "name": row.name,
            "role": row.role,
            "member_count": row.member_count,
            "key_count": row.key_count,
            "created_at": row.created_at,
        }
        for row in groups_result.all()
    ]

    inviter = aliased(User)
    invites_stmt = (
        select(
            GroupInvite,
            Group.name.label("group_name"),
            inviter.username.label("invited_by_username"),
        )
        .join(Group, Group.id == GroupInvite.group_id)
        .outerjoin(inviter, inviter.id == GroupInvite.invited_by)
        .where(
            and_(
                GroupInvite.invitee_username
                == normalize_username(username or ""),
                GroupInvite.status == "pending",
            )
        )
        .order_by(GroupInvite.created_at.desc())
    )
    invites_result = await db.execute(invites_stmt)
    invites = [
        {
            "id": inv.id,
            "group_id": inv.group_id,
            "group_name": group_name,
            "invited_by_username": inv_username,
            "created_at": inv.created_at,
        }
        for inv, group_name, inv_username in invites_result.all()
    ]

    return {"groups": groups, "invites": invites}


async def get_group_detail(
    db: AsyncSession, group_id: str, uid: int | None
) -> dict:
    """Return group details: group, members, invites, is_owner."""
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if not await is_member(db, group_id, uid):
        raise StitchError("Not a member of this group")

    members_stmt = (
        select(GroupMember, User.username)
        .join(User, User.id == GroupMember.user_id)
        .where(GroupMember.group_id == group_id)
        .order_by(GroupMember.joined_at)
    )
    members_result = await db.execute(members_stmt)
    members = [
        {
            "user_id": m.user_id,
            "username": username,
            "role": m.role,
            "joined_at": m.joined_at,
        }
        for m, username in members_result.all()
    ]

    inviter = aliased(User)
    invites_stmt = (
        select(GroupInvite, inviter.username)
        .outerjoin(inviter, inviter.id == GroupInvite.invited_by)
        .where(GroupInvite.group_id == group_id)
        .order_by(GroupInvite.created_at)
    )
    invites_result = await db.execute(invites_stmt)
    invites = [
        {
            "id": inv.id,
            "invitee_username": inv.invitee_username,
            "invited_by_username": inv_username,
            "created_at": inv.created_at,
        }
        for inv, inv_username in invites_result.all()
    ]

    return {
        "group": {
            "id": group.id,
            "name": group.name,
            "owner_id": group.owner_id,
            "max_requests_per_member_daily": group.max_requests_per_member_daily,
            "created_at": group.created_at,
        },
        "members": members,
        "invites": invites,
        "is_owner": uid is not None and group.owner_id == uid,
    }


async def invite_user(
    db: AsyncSession,
    group_id: str,
    invitee_username: str,
    inviter_uid: int | None,
    inviter_username: str | None,
) -> GroupInvite:
    """Owner invites a user by username.

    Guards (self-invite, already-member, existing-pending, group-cap)
    all fail with the SAME uniform error for anti-enumeration.  Always
    creates a pending row (user may not exist yet).
    """
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")

    if inviter_uid is None or group.owner_id != inviter_uid:
        raise StitchError("Only the group owner can invite")

    normalized = normalize_username(invitee_username)
    if not normalized:
        raise StitchError("Username is required")

    # Guards — all fail with uniform error (anti-enumeration)
    if inviter_username and normalized == normalize_username(inviter_username):
        logger.info(
            "Invite rejected: self-invite (group=%s user=%s)", group_id, normalized
        )
        raise StitchError("Invitation could not be sent")

    user_result = await db.execute(
        select(User).where(User.username == normalized)
    )
    user = user_result.scalar_one_or_none()
    if user is not None:
        member_result = await db.execute(
            select(GroupMember).where(
                and_(
                    GroupMember.group_id == group_id,
                    GroupMember.user_id == user.id,
                )
            )
        )
        if member_result.scalar_one_or_none() is not None:
            logger.info(
                "Invite rejected: already member (group=%s user=%s)",
                group_id,
                normalized,
            )
            raise StitchError("Invitation could not be sent")

    pending_result = await db.execute(
        select(GroupInvite).where(
            and_(
                GroupInvite.group_id == group_id,
                GroupInvite.invitee_username == normalized,
                GroupInvite.status == "pending",
            )
        )
    )
    if pending_result.scalar_one_or_none() is not None:
        logger.info(
            "Invite rejected: existing pending (group=%s user=%s)",
            group_id,
            normalized,
        )
        raise StitchError("Invitation could not be sent")

    count_result = await db.execute(
        select(func.count())
        .select_from(GroupMember)
        .where(GroupMember.group_id == group_id)
    )
    if int(count_result.scalar_one()) >= MAX_MEMBERS_PER_GROUP:
        logger.info(
            "Invite rejected: group full (group=%s)", group_id
        )
        raise StitchError("Invitation could not be sent")

    invite = GroupInvite(
        group_id=group_id,
        invitee_username=normalized,
        invited_by=inviter_uid,
        status="pending",
        created_at=_utcnow(),
    )
    db.add(invite)
    await db.flush()
    return invite


async def resolve_invite(
    db: AsyncSession,
    invite_id: str,
    accept: bool,
    invitee_username: str | None,
) -> bool:
    """Invitee accepts or declines an invite."""
    result = await db.execute(
        select(GroupInvite).where(GroupInvite.id == invite_id)
    )
    invite = result.scalar_one_or_none()
    if invite is None:
        raise StitchError("Invitation not found")
    if invite.status != "pending":
        raise StitchError("Invitation is no longer pending")
    if not invitee_username or invite.invitee_username != normalize_username(
        invitee_username
    ):
        raise StitchError("Only the invitee can resolve this invitation")

    if accept:
        count_result = await db.execute(
            select(func.count())
            .select_from(GroupMember)
            .where(GroupMember.group_id == invite.group_id)
        )
        if int(count_result.scalar_one()) >= MAX_MEMBERS_PER_GROUP:
            raise StitchError("Group is full")

        user_result = await db.execute(
            select(User).where(User.username == invite.invitee_username)
        )
        user = user_result.scalar_one_or_none()
        if user is None:
            raise StitchError("User account does not exist yet")

        member = GroupMember(
            group_id=invite.group_id,
            user_id=user.id,
            role="member",
            joined_at=_utcnow(),
        )
        db.add(member)
        invite.status = "accepted"
    else:
        invite.status = "declined"

    invite.resolved_at = _utcnow()
    await db.flush()
    return True


async def revoke_invite(
    db: AsyncSession, invite_id: str, revoker_uid: int | None
) -> bool:
    """Owner or inviter revokes a pending invite."""
    result = await db.execute(
        select(GroupInvite).where(GroupInvite.id == invite_id)
    )
    invite = result.scalar_one_or_none()
    if invite is None:
        raise StitchError("Invitation not found")
    if invite.status != "pending":
        raise StitchError("Invitation is no longer pending")

    group = await get_group(db, invite.group_id)
    if group is None:
        raise StitchError("Group not found")
    if revoker_uid is None or (
        group.owner_id != revoker_uid and invite.invited_by != revoker_uid
    ):
        raise StitchError("Only the group owner or the inviter can revoke")

    invite.status = "revoked"
    invite.resolved_at = _utcnow()
    await db.flush()
    return True


async def remove_member(
    db: AsyncSession,
    group_id: str,
    target_user_id: int,
    caller_uid: int | None,
) -> bool:
    """Owner removes a member; not self; not last owner."""
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if caller_uid is None or group.owner_id != caller_uid:
        raise StitchError("Only the group owner can remove members")

    member_result = await db.execute(
        select(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.user_id == target_user_id,
            )
        )
    )
    member = member_result.scalar_one_or_none()
    if member is None:
        raise StitchError("User is not a member of this group")
    if target_user_id == caller_uid:
        raise StitchError("Cannot remove yourself; use groups_leave or groups_delete")
    if member.role == "owner":
        owner_count_result = await db.execute(
            select(func.count())
            .select_from(GroupMember)
            .where(
                and_(
                    GroupMember.group_id == group_id,
                    GroupMember.role == "owner",
                )
            )
        )
        if int(owner_count_result.scalar_one()) <= 1:
            raise StitchError("Cannot remove the last owner")

    await db.execute(
        delete(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.user_id == target_user_id,
            )
        )
    )
    await db.flush()
    return True


async def leave_group(
    db: AsyncSession, group_id: str, uid: int | None
) -> bool:
    """Member leaves a group; sole owner must delete instead."""
    if uid is None:
        raise StitchError("Not a member of this group")

    member_result = await db.execute(
        select(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.user_id == uid,
            )
        )
    )
    member = member_result.scalar_one_or_none()
    if member is None:
        raise StitchError("Not a member of this group")

    if member.role == "owner":
        owner_count_result = await db.execute(
            select(func.count())
            .select_from(GroupMember)
            .where(
                and_(
                    GroupMember.group_id == group_id,
                    GroupMember.role == "owner",
                )
            )
        )
        if int(owner_count_result.scalar_one()) <= 1:
            raise StitchError("Sole owner must delete the group")

    await db.execute(
        delete(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.user_id == uid,
            )
        )
    )
    await db.flush()
    return True


async def update_group(
    db: AsyncSession, group_id: str, name: str, caller_uid: int | None
) -> Group:
    """Owner renames a group."""
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if caller_uid is None or group.owner_id != caller_uid:
        raise StitchError("Only the group owner can update the group")
    group.name = name
    await db.flush()
    return group


async def delete_group(
    db: AsyncSession, group_id: str, caller_uid: int | None
) -> bool:
    """Owner deletes a group; shares/members/invites cascade; credentials survive."""
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if caller_uid is None or group.owner_id != caller_uid:
        raise StitchError("Only the group owner can delete the group")
    await db.delete(group)
    await db.flush()
    return True


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


# ═══════════════════════════════════════════════════════════════════════════
# Usage accounting + quota + ownership transfer
# ═══════════════════════════════════════════════════════════════════════════


async def list_group_usage(
    db: AsyncSession, group_id: str, uid: int | None
) -> list[dict]:
    """Return per-member usage rows for the last 7 days.

    Members see only their own rows; owners see all members' rows.
    Single query joins ``group_usage`` with ``auth_users`` for usernames.
    """
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if not await is_member(db, group_id, uid):
        raise StitchError("Not a member of this group")

    is_owner = uid is not None and group.owner_id == uid
    # SQLite string comparison on 'YYYY-MM-DD' works for date ordering.
    cutoff_day = (datetime.now(UTC) - timedelta(days=7)).strftime("%Y-%m-%d")

    stmt = (
        select(
            GroupUsage.user_id,
            User.username,
            GroupUsage.day,
            GroupUsage.requests,
            GroupUsage.tokens,
        )
        .join(User, User.id == GroupUsage.user_id)
        .where(
            GroupUsage.group_id == group_id,
            GroupUsage.day >= cutoff_day,
        )
        .order_by(GroupUsage.day.desc(), GroupUsage.user_id)
    )
    if not is_owner:
        stmt = stmt.where(GroupUsage.user_id == uid)

    result = await db.execute(stmt)
    return [
        {
            "user_id": row.user_id,
            "username": row.username,
            "day": row.day,
            "requests": row.requests,
            "tokens": row.tokens,
        }
        for row in result.all()
    ]


async def set_group_quota(
    db: AsyncSession,
    group_id: str,
    max_per_member_daily: int | None,
    caller_uid: int | None,
) -> Group:
    """Owner sets the per-member daily request cap (NULL=unlimited)."""
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if caller_uid is None or group.owner_id != caller_uid:
        raise StitchError("Only the group owner can set the quota")
    if max_per_member_daily is not None and max_per_member_daily < 1:
        raise StitchError("Quota must be a positive integer or null")
    group.max_requests_per_member_daily = max_per_member_daily
    await db.flush()
    return group


async def transfer_ownership(
    db: AsyncSession,
    group_id: str,
    target_user_id: int,
    caller_uid: int | None,
) -> Group:
    """Owner transfers ownership to an existing member (single transaction).

    Swaps roles: old owner → member, target → owner.  Updates
    ``groups.owner_id``.  Target must already be a member.
    """
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if caller_uid is None or group.owner_id != caller_uid:
        raise StitchError("Only the group owner can transfer ownership")

    # Target must be a member.
    target_result = await db.execute(
        select(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.user_id == target_user_id,
            )
        )
    )
    target_member = target_result.scalar_one_or_none()
    if target_member is None:
        raise StitchError("Target user is not a member of this group")
    if target_user_id == caller_uid:
        raise StitchError("You are already the owner")

    # Old owner → member, target → owner.
    old_owner_result = await db.execute(
        select(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.user_id == caller_uid,
            )
        )
    )
    old_owner_member = old_owner_result.scalar_one_or_none()
    if old_owner_member is not None:
        old_owner_member.role = "member"
    target_member.role = "owner"
    group.owner_id = target_user_id
    await db.flush()
    return group
