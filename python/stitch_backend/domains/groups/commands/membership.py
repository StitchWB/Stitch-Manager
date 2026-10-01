"""Membership command handlers."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.core.command_decorator import command
from stitch_backend.domains.groups.commands._common import _caller_uid
from stitch_backend.domains.groups.schemas import SuccessResponse
from stitch_backend.domains.groups.service import leave_group, remove_member


@command("groups_remove_member")
async def cmd_groups_remove_member(db: AsyncSession, params: dict) -> SuccessResponse:
    """Remove a member (owner only; not self; not last owner)."""
    group_id = params["groupId"]
    target_user_id = int(params["userId"])
    uid = _caller_uid(params)

    await remove_member(
        db, group_id, target_user_id, uid
    )

    return SuccessResponse(success=True)


@command("groups_leave")
async def cmd_groups_leave(db: AsyncSession, params: dict) -> SuccessResponse:
    """Leave a group (sole owner must delete instead)."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    await leave_group(db, group_id, uid)

    return SuccessResponse(success=True)
