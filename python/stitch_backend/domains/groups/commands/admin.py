"""Admin oversight command handlers for the groups domain."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import func, select

from stitch_backend.core.command_decorator import command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.ai_gateway.models import CredentialGroupShare
from stitch_backend.domains.auth.models import User
from stitch_backend.domains.auth.roles import role_at_least
from stitch_backend.domains.groups.models import Group, GroupMember
from stitch_backend.domains.groups.schemas import (
    GroupAdminListResponse,
    GroupAdminRowResponse,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


async def list_all_groups(db: AsyncSession) -> list[dict]:
    """Every group globally with owner username and member/share counts."""
    stmt = (
        select(
            Group.id,
            Group.name,
            User.username.label("owner_username"),
            func.count(func.distinct(GroupMember.user_id)).label("member_count"),
            func.count(
                func.distinct(CredentialGroupShare.credential_id)
            ).label("share_count"),
            Group.created_at,
        )
        .select_from(Group)
        .join(User, User.id == Group.owner_id)
        .outerjoin(GroupMember, GroupMember.group_id == Group.id)
        .outerjoin(
            CredentialGroupShare, CredentialGroupShare.group_id == Group.id
        )
        .group_by(Group.id, Group.name, User.username, Group.created_at)
        .order_by(Group.created_at.desc())
    )
    result = await db.execute(stmt)
    return [
        {
            "id": row.id,
            "name": row.name,
            "owner_username": row.owner_username,
            "member_count": row.member_count,
            "share_count": row.share_count,
        }
        for row in result.all()
    ]


@command("groups_admin_list", readonly=True, admin_only=True)
async def cmd_groups_admin_list(
    db: AsyncSession, params: dict
) -> GroupAdminListResponse:
    """List all groups globally (admin only; FE: ``groupsAdminList``)."""
    if not role_at_least(params.get("_caller_role"), "admin"):
        raise StitchError("Requires tier: admin")

    rows = await list_all_groups(db)

    return GroupAdminListResponse(
        groups=[GroupAdminRowResponse(**row) for row in rows]
    )
