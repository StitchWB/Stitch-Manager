"""Credential-pool command handlers."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.core.command_decorator import command
from stitch_backend.domains.groups.commands._common import _caller_uid
from stitch_backend.domains.groups.schemas import PoolListResponse, SuccessResponse
from stitch_backend.domains.groups.service import (
    list_pool,
    share_credential,
    unshare_credential,
)


@command("groups_share_credential")
async def cmd_groups_share_credential(db: AsyncSession, params: dict) -> SuccessResponse:
    """Share a credential to a group (credential owner + member; idempotent)."""
    credential_id = params["credentialId"]
    group_id = params["groupId"]
    uid = _caller_uid(params)

    await share_credential(
        db, credential_id, group_id, uid
    )

    return SuccessResponse(success=True)


@command("groups_unshare_credential")
async def cmd_groups_unshare_credential(db: AsyncSession, params: dict) -> SuccessResponse:
    """Unshare a credential (credential owner OR group owner)."""
    credential_id = params["credentialId"]
    group_id = params["groupId"]
    uid = _caller_uid(params)

    await unshare_credential(
        db, credential_id, group_id, uid
    )

    return SuccessResponse(success=True)


@command("groups_pool_list", readonly=True)
async def cmd_groups_pool_list(db: AsyncSession, params: dict) -> PoolListResponse:
    """List pooled credentials for a group (members only; masked secrets)."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    items = await list_pool(db, group_id, uid)

    return PoolListResponse(items=items)
