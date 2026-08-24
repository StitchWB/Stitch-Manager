"""Groups command handlers — registered via ``@register_command``.

Mirrors the pattern in ``domains/ai_gateway/commands.py``: each handler
validates params, delegates to the service layer via
``run_in_session`` / ``run_in_read_session``, and returns a Pydantic
response model from :mod:`stitch_backend.domains.groups.schemas`.

The dispatcher (``cmd_dispatcher._serialise``) calls
``model_dump(mode="json", by_alias=True)`` on the way out; since groups
schemas use snake_case field names with no aliases, ``by_alias=True``
returns the field names verbatim — the wire format is unchanged.

Response shapes (snake_case — the frontend agent codes against these):
  - groups_create          → GroupCreateResponse{group: GroupResponse}
  - groups_list            → GroupListResponse{groups, invites}
  - groups_get             → GroupDetailResponse{group, members, invites, is_owner}
  - groups_invite          → InviteCreateResponse{invite: InviteResponse}
  - groups_invite_resolve  → SuccessResponse
  - groups_invite_revoke   → SuccessResponse
  - groups_remove_member   → SuccessResponse
  - groups_leave           → SuccessResponse
  - groups_update          → GroupResponse
  - groups_delete          → SuccessResponse
  - groups_share_credential    → SuccessResponse
  - groups_unshare_credential  → SuccessResponse
  - groups_pool_list       → PoolListResponse{items}
  - groups_usage_list      → UsageListResponse{rows, max_per_member_daily}
  - groups_set_quota       → GroupResponse
  - groups_transfer_ownership  → GroupResponse
"""

from __future__ import annotations

import asyncio
import logging

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.auth.roles import role_at_least
from stitch_backend.domains.groups.schemas import (
    GroupCreateResponse,
    GroupDetailResponse,
    GroupListResponse,
    GroupResponse,
    InviteCreateResponse,
    InviteResponse,
    PoolListResponse,
    SuccessResponse,
    UsageListResponse,
)
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

logger = logging.getLogger(__name__)


def _caller_uid(params: dict) -> int | None:
    """Extract the caller's user ID (None when auth disabled / desktop)."""
    return params.get("_caller_user_id")


# ═══════════════════════════════════════════════════════════════════════════
# Group CRUD
# ═══════════════════════════════════════════════════════════════════════════


@register_command("groups_create")
async def cmd_groups_create(params: dict) -> GroupCreateResponse:
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
    return GroupCreateResponse(group=GroupResponse.model_validate(group))


@register_command("groups_list", readonly=True)
async def cmd_groups_list(params: dict) -> GroupListResponse:
    """List groups where caller is a member + pending invites for caller."""
    uid = _caller_uid(params)
    username = params.get("_caller_username")

    async def _op(session):
        return await list_groups_for_user(session, uid, username)

    result = await run_in_read_session(_op)
    return GroupListResponse(**result)


@register_command("groups_get", readonly=True)
async def cmd_groups_get(params: dict) -> GroupDetailResponse:
    """Get group details (members only)."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await get_group_detail(session, group_id, uid)

    result = await run_in_read_session(_op)
    return GroupDetailResponse(**result)


@register_command("groups_update")
async def cmd_groups_update(params: dict) -> GroupResponse:
    """Rename a group (owner only). Returns the updated group (FE: Promise<Group>)."""
    group_id = params["groupId"]
    name = str(params.get("name", "")).strip()
    if not name:
        raise StitchError("Group name is required")
    uid = _caller_uid(params)

    async def _op(session):
        return await update_group(session, group_id, name, uid)

    group = await run_in_session(_op)
    return GroupResponse.model_validate(group)


@register_command("groups_delete")
async def cmd_groups_delete(params: dict) -> SuccessResponse:
    """Delete a group (owner only; shares/members/invites cascade)."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await delete_group(session, group_id, uid)

    await run_in_session(_op)
    return SuccessResponse(success=True)


# ═══════════════════════════════════════════════════════════════════════════
# Invites
# ═══════════════════════════════════════════════════════════════════════════


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


@register_command("groups_invite_resolve")
async def cmd_groups_invite_resolve(params: dict) -> SuccessResponse:
    """Accept or decline an invite (invitee only)."""
    invite_id = params["inviteId"]
    accept = bool(params.get("accept", False))
    invitee_username = params.get("_caller_username")

    async def _op(session):
        return await resolve_invite(
            session, invite_id, accept, invitee_username
        )

    await run_in_session(_op)
    return SuccessResponse(success=True)


@register_command("groups_invite_revoke")
async def cmd_groups_invite_revoke(params: dict) -> SuccessResponse:
    """Revoke a pending invite (owner or inviter)."""
    invite_id = params["inviteId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await revoke_invite(session, invite_id, uid)

    await run_in_session(_op)
    return SuccessResponse(success=True)


# ═══════════════════════════════════════════════════════════════════════════
# Membership
# ═══════════════════════════════════════════════════════════════════════════


@register_command("groups_remove_member")
async def cmd_groups_remove_member(params: dict) -> SuccessResponse:
    """Remove a member (owner only; not self; not last owner)."""
    group_id = params["groupId"]
    target_user_id = int(params["userId"])
    uid = _caller_uid(params)

    async def _op(session):
        return await remove_member(
            session, group_id, target_user_id, uid
        )

    await run_in_session(_op)
    return SuccessResponse(success=True)


@register_command("groups_leave")
async def cmd_groups_leave(params: dict) -> SuccessResponse:
    """Leave a group (sole owner must delete instead)."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await leave_group(session, group_id, uid)

    await run_in_session(_op)
    return SuccessResponse(success=True)


# ═══════════════════════════════════════════════════════════════════════════
# Credential sharing
# ═══════════════════════════════════════════════════════════════════════════


@register_command("groups_share_credential")
async def cmd_groups_share_credential(params: dict) -> SuccessResponse:
    """Share a credential to a group (credential owner + member; idempotent)."""
    credential_id = params["credentialId"]
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await share_credential(
            session, credential_id, group_id, uid
        )

    await run_in_session(_op)
    return SuccessResponse(success=True)


@register_command("groups_unshare_credential")
async def cmd_groups_unshare_credential(params: dict) -> SuccessResponse:
    """Unshare a credential (credential owner OR group owner)."""
    credential_id = params["credentialId"]
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await unshare_credential(
            session, credential_id, group_id, uid
        )

    await run_in_session(_op)
    return SuccessResponse(success=True)


@register_command("groups_pool_list", readonly=True)
async def cmd_groups_pool_list(params: dict) -> PoolListResponse:
    """List pooled credentials for a group (members only; masked secrets)."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await list_pool(session, group_id, uid)

    items = await run_in_read_session(_op)
    return PoolListResponse(items=items)


# ═══════════════════════════════════════════════════════════════════════════
# Usage accounting + quota + ownership transfer
# ═══════════════════════════════════════════════════════════════════════════


@register_command("groups_usage_list", readonly=True)
async def cmd_groups_usage_list(params: dict) -> UsageListResponse:
    """List per-member usage for the last 30 days (members: own; owner: all).

    Returns rows + ``max_per_member_daily`` (the group-wide cap) so members
    can see the fair-use limit context.
    """
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        return await list_group_usage(session, group_id, uid)

    result = await run_in_read_session(_op)
    return UsageListResponse(**result)


@register_command("groups_set_quota")
async def cmd_groups_set_quota(params: dict) -> GroupResponse:
    """Set the per-member daily request cap (owner only; null=unlimited)."""
    group_id = params["groupId"]
    raw = params.get("maxPerMemberDaily")
    max_per_member = int(raw) if raw is not None else None
    uid = _caller_uid(params)

    async def _op(session):
        return await set_group_quota(session, group_id, max_per_member, uid)

    group = await run_in_session(_op)
    return GroupResponse.model_validate(group)


@register_command("groups_transfer_ownership")
async def cmd_groups_transfer_ownership(params: dict) -> GroupResponse:
    """Transfer group ownership to an existing member (owner only)."""
    group_id = params["groupId"]
    target_user_id = int(params["userId"])
    uid = _caller_uid(params)

    async def _op(session):
        return await transfer_ownership(session, group_id, target_user_id, uid)

    group = await run_in_session(_op)
    return GroupResponse.model_validate(group)
