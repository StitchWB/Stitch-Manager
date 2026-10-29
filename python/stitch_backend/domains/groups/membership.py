"""Membership helpers, username normalization, and per-domain caps."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import and_, delete, func, select

from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.groups.models import Group, GroupMember
from stitch_backend.domains.settings.models import Setting

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

GROUP_ROLES = ("owner", "admin", "member")

MAX_GROUPS_PER_OWNER = 3
MAX_MEMBERS_PER_GROUP = 10
MAX_GATED_PLUGINS_PER_GROUP = 5

GROUPS_MAX_PER_USER_KEY = "groups.max_per_user"
GROUPS_OPEN_MAX_MEMBERS_KEY = "groups.open.max_members"
GROUPS_MAX_GATED_PLUGINS_KEY = "groups.max_gated_plugins"


def normalize_username(username: str) -> str:
    """Normalize a username for invite matching: strip '@', lower."""
    return (username or "").strip().lstrip("@").lower()


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


async def group_role(
    db: AsyncSession, group_id: str, uid: int | None
) -> str | None:
    """Return the caller's role in *group_id* (``'owner'``/``'admin'``/``'member'``) or ``None``.

    Used by permission checks that need to distinguish group owners from
    regular members (e.g. account unshare / delete rights).
    """
    if uid is None:
        return None
    result = await db.execute(
        select(GroupMember.role).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.user_id == uid,
            )
        )
    )
    return result.scalar_one_or_none()


async def is_owner_or_admin(
    db: AsyncSession, group_id: str, uid: int | None
) -> bool:
    """True when *uid* holds the ``owner`` or ``admin`` role in *group_id*.

    The owner is always duplicated as a member row with role='owner', so
    the role lookup covers both.  Ownership transfer stays owner-only and
    is checked against ``Group.owner_id`` separately.
    """
    return await group_role(db, group_id, uid) in ("owner", "admin")


async def _int_setting(
    db: AsyncSession, key: str, fallback: int
) -> int:
    result = await db.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    if row is None or row.value is None:
        return fallback
    try:
        return int(row.value)
    except (TypeError, ValueError):
        return fallback


async def max_groups_per_owner(db: AsyncSession) -> int:
    """Effective groups-per-owner cap (``groups.max_per_user`` setting,
    ``MAX_GROUPS_PER_OWNER`` fallback)."""
    return await _int_setting(db, GROUPS_MAX_PER_USER_KEY, MAX_GROUPS_PER_OWNER)


async def max_members_per_group(db: AsyncSession) -> int:
    """Effective members-per-group cap (``groups.open.max_members`` setting,
    ``MAX_MEMBERS_PER_GROUP`` fallback)."""
    return await _int_setting(
        db, GROUPS_OPEN_MAX_MEMBERS_KEY, MAX_MEMBERS_PER_GROUP
    )


async def max_gated_plugins(db: AsyncSession) -> int:
    """Effective gated-plugins-per-group cap (``groups.max_gated_plugins``
    setting, ``MAX_GATED_PLUGINS_PER_GROUP`` fallback)."""
    return await _int_setting(
        db, GROUPS_MAX_GATED_PLUGINS_KEY, MAX_GATED_PLUGINS_PER_GROUP
    )


async def remove_member(
    db: AsyncSession,
    group_id: str,
    target_user_id: int,
    caller_uid: int | None,
) -> bool:
    """Owner or admin removes a member; not self; not last owner."""
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if caller_uid is None or not await is_owner_or_admin(
        db, group_id, caller_uid
    ):
        raise StitchError("Only the group owner or an admin can remove members")

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
