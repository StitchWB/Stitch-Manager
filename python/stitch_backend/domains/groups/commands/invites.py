"""Invite command handlers."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

import asyncio
import logging

from stitch_backend.core.command_decorator import command
from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_session
from stitch_backend.domains.groups.commands._common import _caller_uid
from stitch_backend.domains.groups.schemas import (
    InviteCreateResponse,
    InviteResponse,
    SuccessResponse,
)
from stitch_backend.domains.groups.service import (
    invite_user,
    resolve_invite,
    revoke_invite,
)

logger = logging.getLogger(__name__)


@register_command("groups_invite")
async def cmd_groups_invite(params: dict) -> InviteCreateResponse:
    """Invite a user by username (owner only; uniform error on guards)."""
    group_id = params["groupId"]
    username = str(params.get("username", "")).strip()
    if not username:
        raise StitchError("Username is required")
    uid = _caller_uid(params)
    inviter_username = params.get("_caller_username")

    async def _op(session):
        return await invite_user(
            session,
            group_id=group_id,
            invitee_username=username,
            inviter_uid=uid,
            inviter_username=inviter_username,
        )

    invite = await run_in_session(_op)

    # TG-bot DM is fire-and-forget; the group name is fetched best-effort for the DM text.
    try:
        from stitch_backend.database import run_in_read_session
        from stitch_backend.domains.groups.service import get_group

        async def _fetch_group(session):
            return await get_group(session, group_id)

        group = await run_in_read_session(_fetch_group)
        group_name = group.name if group is not None else ""
    except Exception:
        group_name = ""

    try:
        from stitch_backend.domains.groups.notify import notify_group_invite

        asyncio.create_task(
            notify_group_invite(
                invitee_username=invite.invitee_username,
                group_name=group_name,
                inviter_username=inviter_username or "",
            )
        )
    except Exception:
        logger.debug("Failed to schedule invite DM", exc_info=True)

    return InviteCreateResponse(
        invite=InviteResponse(
            id=invite.id,
            group_id=invite.group_id,
            invitee_username=invite.invitee_username,
            invited_by_username=inviter_username,
            status=invite.status,
            created_at=invite.created_at,
        )
    )


@command("groups_invite_resolve")
async def cmd_groups_invite_resolve(db: AsyncSession, params: dict) -> SuccessResponse:
    """Accept or decline an invite (invitee only)."""
    invite_id = params["inviteId"]
    accept = bool(params.get("accept", False))
    invitee_username = params.get("_caller_username")

    await resolve_invite(
        db, invite_id, accept, invitee_username
    )

    return SuccessResponse(success=True)


@command("groups_invite_revoke")
async def cmd_groups_invite_revoke(db: AsyncSession, params: dict) -> SuccessResponse:
    """Revoke a pending invite (owner or inviter)."""
    invite_id = params["inviteId"]
    uid = _caller_uid(params)

    await revoke_invite(db, invite_id, uid)

    return SuccessResponse(success=True)
