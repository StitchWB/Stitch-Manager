"""Group invites: send / resolve / revoke."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy import and_, func, select

from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.auth.models import User
from stitch_backend.domains.groups.membership import (
    MAX_MEMBERS_PER_GROUP,
    get_group,
    normalize_username,
)
from stitch_backend.domains.groups.models import GroupInvite, GroupMember, _utcnow

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# Pinned: invite-rejection audit lines keep the historical service logger name.
logger = logging.getLogger("stitch_backend.domains.groups.service")


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
