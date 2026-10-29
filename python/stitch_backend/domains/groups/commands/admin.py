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
    GroupResponse,
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


async def _get_group_or_404(db: AsyncSession, group_id: str) -> Group:
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if group is None:
        raise StitchError("Group not found")
    return group


@command("group_verify", admin_only=True)
async def cmd_group_verify(db: AsyncSession, params: dict) -> GroupResponse:
    """Set a group's level to 'verified' (admin only; FE: ``groupVerify``)."""
    if not role_at_least(params.get("_caller_role"), "admin"):
        raise StitchError("Requires tier: admin")
    group_id = str(params.get("groupId", ""))
    if not group_id:
        raise StitchError("groupId is required")

    group = await _get_group_or_404(db, group_id)
    group.level = "verified"
    await db.flush()

    return GroupResponse.model_validate(group)


@command("group_suspend", admin_only=True)
async def cmd_group_suspend(db: AsyncSession, params: dict) -> GroupResponse:
    """Set a group's level to 'suspended' and revoke its plugin grants.

    Admin only (FE: ``groupSuspend``).  Every ``GroupPluginGrant`` row of
    the group is removed (one audit entry per grant) so a suspended group
    loses gated plugins immediately.
    """
    if not role_at_least(params.get("_caller_role"), "admin"):
        raise StitchError("Requires tier: admin")
    group_id = str(params.get("groupId", ""))
    if not group_id:
        raise StitchError("groupId is required")

    group = await _get_group_or_404(db, group_id)
    group.level = "suspended"

    from stitch_backend.domains.plugin_distribution.entitlements import (
        invalidate_entitlements_cache,
    )
    from stitch_backend.domains.plugin_distribution.grant_commands import (
        revoke_group_grants,
    )

    await revoke_group_grants(
        db, group_id=group_id, actor_id=params.get("_caller_user_id")
    )
    await db.flush()
    invalidate_entitlements_cache()

    return GroupResponse.model_validate(group)
