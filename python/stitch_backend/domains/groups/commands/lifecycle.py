"""Group CRUD and ownership-transfer command handlers."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.core.command_decorator import command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.auth.roles import role_at_least
from stitch_backend.domains.groups.commands._common import _caller_uid
from stitch_backend.domains.groups.schemas import (
    GroupCreateResponse,
    GroupDetailResponse,
    GroupListResponse,
    GroupResponse,
    SuccessResponse,
)
from stitch_backend.domains.groups.service import (
    create_group,
    delete_group,
    get_group_detail,
    list_groups_for_user,
    transfer_ownership,
    update_group,
)


@command("groups_create")
async def cmd_groups_create(db: AsyncSession, params: dict) -> GroupCreateResponse:
    """Create a group (vip+ gate; max 3 groups/owner; creator=owner-member)."""
    if not role_at_least(params.get("_caller_role"), "vip"):
        raise StitchError("Requires tier: vip")
    name = str(params.get("name", "")).strip()
    if not name:
        raise StitchError("Group name is required")
    uid = _caller_uid(params)

    group = await create_group(db, name=name, owner_id=uid)

    return GroupCreateResponse(group=GroupResponse.model_validate(group))


@command("groups_list", readonly=True)
async def cmd_groups_list(db: AsyncSession, params: dict) -> GroupListResponse:
    """List groups where caller is a member + pending invites for caller."""
    uid = _caller_uid(params)
    username = params.get("_caller_username")

    result = await list_groups_for_user(db, uid, username)

    return GroupListResponse(**result)


@command("groups_get", readonly=True)
async def cmd_groups_get(db: AsyncSession, params: dict) -> GroupDetailResponse:
    """Get group details (members only)."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    result = await get_group_detail(db, group_id, uid)

    return GroupDetailResponse(**result)


@command("groups_update")
async def cmd_groups_update(db: AsyncSession, params: dict) -> GroupResponse:
    """Rename a group (owner only). Returns the updated group (FE: Promise<Group>)."""
    group_id = params["groupId"]
    name = str(params.get("name", "")).strip()
    if not name:
        raise StitchError("Group name is required")
    uid = _caller_uid(params)

    group = await update_group(db, group_id, name, uid)

    return GroupResponse.model_validate(group)


@command("groups_delete")
async def cmd_groups_delete(db: AsyncSession, params: dict) -> SuccessResponse:
    """Delete a group (owner only; shares/members/invites cascade)."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    await delete_group(db, group_id, uid)

    return SuccessResponse(success=True)


@command("groups_transfer_ownership")
async def cmd_groups_transfer_ownership(db: AsyncSession, params: dict) -> GroupResponse:
    """Transfer group ownership to an existing member (owner only)."""
    group_id = params["groupId"]
    target_user_id = int(params["userId"])
    uid = _caller_uid(params)

    group = await transfer_ownership(db, group_id, target_user_id, uid)

    return GroupResponse.model_validate(group)
