"""Group CRUD and ownership transfer."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import and_, func, select
from sqlalchemy.orm import aliased

from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.ai_gateway.models import CredentialGroupShare
from stitch_backend.domains.auth.models import User
from stitch_backend.domains.groups.membership import (
    MAX_GROUPS_PER_OWNER,
    get_group,
    is_member,
    normalize_username,
)
from stitch_backend.domains.groups.models import (
    Group,
    GroupInvite,
    GroupMember,
    _utcnow,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


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
