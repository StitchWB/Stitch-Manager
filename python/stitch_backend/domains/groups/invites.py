"""Group invites: send / resolve / revoke."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import ColumnElement, and_, func, or_, select, text

from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.auth.models import User
from stitch_backend.domains.groups.membership import (
    get_group,
    is_owner_or_admin,
    max_members_per_group,
    normalize_username,
)
from stitch_backend.domains.groups.models import GroupInvite, GroupMember, _utcnow

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# Pinned: invite-rejection audit lines keep the historical service logger name.
logger = logging.getLogger("stitch_backend.domains.groups.service")

INVITE_TTL_DAYS = 7


def _now_naive() -> datetime:
    # SQLite DATETIME round-trips drop tzinfo; compare in naive UTC.
    return datetime.now(UTC).replace(tzinfo=None)


def invite_not_expired() -> ColumnElement[bool]:
    # NULL expires_at = pre-TTL legacy row: stays pending forever.
    return or_(
        GroupInvite.expires_at.is_(None),
        GroupInvite.expires_at > _now_naive(),
    )


def _is_expired(expires_at: datetime | None) -> bool:
    # ORM-fresh values are tz-aware; SQLite round-trips are naive UTC.
    if expires_at is None:
        return False
    if expires_at.tzinfo is not None:
        expires_at = expires_at.astimezone(UTC).replace(tzinfo=None)
    return expires_at <= _now_naive()


async def _take_group_write_lock(db: AsyncSession, group_id: str) -> None:
    # No-op UPDATE takes SQLite's write lock, serializing check-then-insert (TOCTOU).
    await db.execute(
        text("UPDATE groups SET id = id WHERE id = :gid"),
        {"gid": group_id},
    )


async def invite_user(
    db: AsyncSession,
    group_id: str,
    invitee_username: str,
    inviter_uid: int | None,
    inviter_username: str | None,
) -> GroupInvite:
    """Owner or admin invites a user by username.

    Guards (self-invite, already-member, existing-pending, group-cap)
    all fail with the SAME uniform error for anti-enumeration.  Always
    creates a pending row (user may not exist yet).
    """
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")

    if inviter_uid is None or not await is_owner_or_admin(
        db, group_id, inviter_uid
    ):
        raise StitchError("Only the group owner or an admin can invite")

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

    await _take_group_write_lock(db, group_id)

    pending_result = await db.execute(
        select(GroupInvite).where(
            and_(
                GroupInvite.group_id == group_id,
                GroupInvite.invitee_username == normalized,
                GroupInvite.status == "pending",
                invite_not_expired(),
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
    if int(count_result.scalar_one()) >= await max_members_per_group(db):
        logger.info(
            "Invite rejected: group full (group=%s)", group_id
        )
        raise StitchError("Invitation could not be sent")

    invite = GroupInvite(
        group_id=group_id,
        invitee_username=normalized,
        invitee_user_id=user.id if user is not None else None,
        invited_by=inviter_uid,
        status="pending",
        created_at=_utcnow(),
        expires_at=_utcnow() + timedelta(days=INVITE_TTL_DAYS),
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
    if _is_expired(invite.expires_at):
        raise StitchError("Invitation has expired")

    if accept:
        await _take_group_write_lock(db, invite.group_id)
        count_result = await db.execute(
            select(func.count())
            .select_from(GroupMember)
            .where(GroupMember.group_id == invite.group_id)
        )
        if int(count_result.scalar_one()) >= await max_members_per_group(db):
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
