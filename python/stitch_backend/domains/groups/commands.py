"""Groups command handlers — registered via ``@register_command``.

Mirrors the pattern in ``domains/ai_gateway/commands.py``: each handler
validates params, delegates to the service layer via
``run_in_session`` / ``run_in_read_session``, and returns a plain dict.

The dispatcher (``cmd_dispatcher._serialise``) handles JSON conversion
of datetime objects in plain dicts automatically.

Response shapes (snake_case — the frontend agent codes against these):
  - groups_create          → {"group": {id, name, owner_id, created_at}}
  - groups_list            → {"groups": [...], "invites": [...]}
  - groups_get             → {"group": {...}, "members": [...], "invites": [...], "is_owner": bool}
  - groups_invite          → {"invite": {id, group_id, invitee_username, invited_by_username, status, created_at}}
  - groups_invite_resolve  → {"success": true}
  - groups_invite_revoke   → {"success": true}
  - groups_remove_member   → {"success": true}
  - groups_leave           → {"success": true}
  - groups_update          → {id, name, owner_id, created_at}
  - groups_delete          → {"success": true}
  - groups_share_credential    → {"success": true}
  - groups_unshare_credential  → {"success": true}
  - groups_pool_list       → {"items": [{credential_id, label, ...}]}
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.auth.roles import role_at_least
from stitch_backend.domains.groups.service import (
    create_group,
    delete_group,
    get_group_detail,
    invite_user,
    leave_group,
    list_group_usage,
    list_groups_for_user,
    list_pool,
    remove_member,
    resolve_invite,
    revoke_invite,
    set_group_quota,
    share_credential,
    transfer_ownership,
    unshare_credential,
    update_group,
)

if TYPE_CHECKING:
    from stitch_backend.domains.groups.models import Group, GroupInvite

logger = logging.getLogger(__name__)


def _caller_uid(params: dict) -> int | None:
    """Extract the caller's user ID (None when auth disabled / desktop)."""
    return params.get("_caller_user_id")


def _group_to_dict(group: Group) -> dict:
    """Serialize a Group ORM object to a dict."""
    return {
        "id": group.id,
        "name": group.name,
        "owner_id": group.owner_id,
        "max_requests_per_member_daily": group.max_requests_per_member_daily,
        "created_at": group.created_at,
    }


def _invite_to_dict(
    invite: GroupInvite, inviter_username: str | None = None
) -> dict:
    """Serialize a GroupInvite ORM object to a dict.

    ``invited_by_username`` is the inviter's username (FE GroupInvite type).
    ``status`` is kept for backward compat with existing callers/tests.
    """
    return {
        "id": invite.id,
        "group_id": invite.group_id,
        "invitee_username": invite.invitee_username,
        "invited_by_username": inviter_username,
        "status": invite.status,
        "created_at": invite.created_at,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Group CRUD
# ═══════════════════════════════════════════════════════════════════════════


@register_command("groups_create")
async def cmd_groups_create(params: dict) -> dict:
    """Create a group (vip+ gate; max 3 groups/owner; creator=owner-member)."""
    if not role_at_least(params.get("_caller_role"), "vip"):
        raise StitchError("Requires tier: vip")
    name = str(params.get("name", "")).strip()
    if not name:
        raise StitchError("Group name is required")
    uid = _caller_uid(params)

    async def _op(session):
        return await create_group(session, name=name, owner_id=uid)

    group = await run_in_session(_op)
    return {"group": _group_to_dict(group)}


@register_command("groups_list", readonly=True)
async def cmd_groups_list(params: dict) -> dict:
    """List groups where caller is a member + pending invites for caller."""
    uid = _caller_uid(params)
    username = params.get("_caller_username")

    async def _op(session):
        return await list_groups_for_user(session, uid, username)

    return await run_in_read_session(_op)


@register_command("groups_get", readonly=True)
async def cmd_groups_get(params: dict) -> dict:
    """Get group details (members only)."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await get_group_detail(session, group_id, uid)

    return await run_in_read_session(_op)


@register_command("groups_update")
async def cmd_groups_update(params: dict) -> dict:
    """Rename a group (owner only). Returns the updated group (FE: Promise<Group>)."""
    group_id = params["groupId"]
    name = str(params.get("name", "")).strip()
    if not name:
        raise StitchError("Group name is required")
    uid = _caller_uid(params)

    async def _op(session):
        return await update_group(session, group_id, name, uid)

    group = await run_in_session(_op)
    return _group_to_dict(group)


@register_command("groups_delete")
async def cmd_groups_delete(params: dict) -> dict:
    """Delete a group (owner only; shares/members/invites cascade)."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await delete_group(session, group_id, uid)

    await run_in_session(_op)
    return {"success": True}


# ═══════════════════════════════════════════════════════════════════════════
# Invites
# ═══════════════════════════════════════════════════════════════════════════


@register_command("groups_invite")
async def cmd_groups_invite(params: dict) -> dict:
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

    # Fire-and-forget TG-bot DM notification (never blocks the invite).
    # The group name is needed for the DM text; fetch it best-effort.
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
                invitee_username=invite["invitee_username"],
                group_name=group_name,
                inviter_username=inviter_username or "",
            )
        )
    except Exception:
        logger.debug("Failed to schedule invite DM", exc_info=True)

    return {"invite": _invite_to_dict(invite, inviter_username)}


@register_command("groups_invite_resolve")
async def cmd_groups_invite_resolve(params: dict) -> dict:
    """Accept or decline an invite (invitee only)."""
    invite_id = params["inviteId"]
    accept = bool(params.get("accept", False))
    invitee_username = params.get("_caller_username")

    async def _op(session):
        return await resolve_invite(
            session, invite_id, accept, invitee_username
        )

    await run_in_session(_op)
    return {"success": True}


@register_command("groups_invite_revoke")
async def cmd_groups_invite_revoke(params: dict) -> dict:
    """Revoke a pending invite (owner or inviter)."""
    invite_id = params["inviteId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await revoke_invite(session, invite_id, uid)

    await run_in_session(_op)
    return {"success": True}


# ═══════════════════════════════════════════════════════════════════════════
# Membership
# ═══════════════════════════════════════════════════════════════════════════


@register_command("groups_remove_member")
async def cmd_groups_remove_member(params: dict) -> dict:
    """Remove a member (owner only; not self; not last owner)."""
    group_id = params["groupId"]
    target_user_id = int(params["userId"])
    uid = _caller_uid(params)

    async def _op(session):
        return await remove_member(
            session, group_id, target_user_id, uid
        )

    await run_in_session(_op)
    return {"success": True}


@register_command("groups_leave")
async def cmd_groups_leave(params: dict) -> dict:
    """Leave a group (sole owner must delete instead)."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await leave_group(session, group_id, uid)

    await run_in_session(_op)
    return {"success": True}


# ═══════════════════════════════════════════════════════════════════════════
# Credential sharing
# ═══════════════════════════════════════════════════════════════════════════


@register_command("groups_share_credential")
async def cmd_groups_share_credential(params: dict) -> dict:
    """Share a credential to a group (credential owner + member; idempotent)."""
    credential_id = params["credentialId"]
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await share_credential(
            session, credential_id, group_id, uid
        )

    await run_in_session(_op)
    return {"success": True}


@register_command("groups_unshare_credential")
async def cmd_groups_unshare_credential(params: dict) -> dict:
    """Unshare a credential (credential owner OR group owner)."""
    credential_id = params["credentialId"]
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await unshare_credential(
            session, credential_id, group_id, uid
        )

    await run_in_session(_op)
    return {"success": True}


@register_command("groups_pool_list", readonly=True)
async def cmd_groups_pool_list(params: dict) -> dict:
    """List pooled credentials for a group (members only; masked secrets)."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await list_pool(session, group_id, uid)

    items = await run_in_read_session(_op)
    return {"items": items}


# ═══════════════════════════════════════════════════════════════════════════
# Usage accounting + quota + ownership transfer
# ═══════════════════════════════════════════════════════════════════════════


@register_command("groups_usage_list", readonly=True)
async def cmd_groups_usage_list(params: dict) -> dict:
    """List per-member usage for the last 7 days (members: own; owner: all)."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await list_group_usage(session, group_id, uid)

    rows = await run_in_read_session(_op)
    return {"rows": rows}


@register_command("groups_set_quota")
async def cmd_groups_set_quota(params: dict) -> dict:
    """Set the per-member daily request cap (owner only; null=unlimited)."""
    group_id = params["groupId"]
    raw = params.get("maxPerMemberDaily")
    max_per_member = int(raw) if raw is not None else None
    uid = _caller_uid(params)

    async def _op(session):
        return await set_group_quota(session, group_id, max_per_member, uid)

    group = await run_in_session(_op)
    return _group_to_dict(group)


@register_command("groups_transfer_ownership")
async def cmd_groups_transfer_ownership(params: dict) -> dict:
    """Transfer group ownership to an existing member (owner only)."""
    group_id = params["groupId"]
    target_user_id = int(params["userId"])
    uid = _caller_uid(params)

    async def _op(session):
        return await transfer_ownership(session, group_id, target_user_id, uid)

    group = await run_in_session(_op)
    return _group_to_dict(group)
