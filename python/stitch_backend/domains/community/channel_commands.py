"""Community-channel catalog commands (local store, admin-only writes).

Response shapes (snake_case, no aliases — the FE codes against these):
  - community_channels_list    -> {"items": [ChannelItem, ...]}
  - community_channels_create  -> ChannelItem
  - community_channels_update  -> ChannelItem (takes ``id``)
  - community_channels_delete  -> {"success": True} (takes ``id``)
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from stitch_backend.core.command_decorator import command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.auth.roles import role_at_least

from .channel_service import (
    create_channel,
    delete_channel,
    list_channels,
    update_channel,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


def _require_admin(params: dict) -> None:
    # dispatcher enforces meta.admin_only; this guards direct handler calls
    if not role_at_least(params.get("_caller_role"), "admin"):
        raise StitchError("Requires tier: admin")


def _channel_id(params: dict) -> str:
    channel_id = params.get("id")
    if not isinstance(channel_id, str) or not channel_id:
        raise StitchError("Channel id is required")
    return channel_id


@command("community_channels_list", readonly=True)
async def cmd_community_channels_list(
    db: AsyncSession, params: dict
) -> dict[str, Any]:
    """List every local community channel (admin catalog view)."""
    return {"items": await list_channels(db)}


@command("community_channels_create", admin_only=True)
async def cmd_community_channels_create(
    db: AsyncSession, params: dict
) -> dict[str, Any]:
    _require_admin(params)
    return await create_channel(db, params)


@command("community_channels_update", admin_only=True)
async def cmd_community_channels_update(
    db: AsyncSession, params: dict
) -> dict[str, Any]:
    _require_admin(params)
    return await update_channel(db, _channel_id(params), params)


@command("community_channels_delete", admin_only=True)
async def cmd_community_channels_delete(
    db: AsyncSession, params: dict
) -> dict[str, Any]:
    _require_admin(params)
    await delete_channel(db, _channel_id(params))
    return {"success": True}
