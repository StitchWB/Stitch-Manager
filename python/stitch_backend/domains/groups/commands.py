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
  - groups_share_account   → SuccessResponse
  - groups_unshare_account → SuccessResponse
  - groups_list_accounts   → list[GroupAccountItemResponse]  (camelCase aliases)
"""

from __future__ import annotations

import asyncio
import logging

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.auth.roles import role_at_least
from stitch_backend.domains.groups.schemas import (
    GroupAccountItemResponse,
    GroupCreateResponse,
    GroupDetailResponse,
    GroupListResponse,
    GroupResponse,
    InviteCreateResponse,
    InviteResponse,
    PoolListResponse,
    QuotaRuleResponse,
    QuotaRulesListResponse,
    SuccessResponse,
    UsageListResponse,
)
from stitch_backend.domains.groups.service import (
    create_group,
    delete_group,
    delete_quota_rule,
    get_group_detail,
    group_role,
    invite_user,
    is_group_owner_of_resource,
    is_member,
    leave_group,
    list_group_usage,
    list_groups_for_user,
    list_pool,
    list_quota_rules,
    remove_member,
    resolve_invite,
    revoke_invite,
    set_group_quota,
    set_quota_rule,
    share_credential,
    share_resource,
    transfer_ownership,
    unshare_credential,
    unshare_resource,
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
    """Set the per-member daily request cap (owner only; null=unlimited).

    Legacy single-cap API — kept for backward compatibility; evaluated as
    the lowest-priority member rule.  New code should use
    ``groups_quota_rule_set``.
    """
    group_id = params["groupId"]
    raw = params.get("maxPerMemberDaily")
    max_per_member = int(raw) if raw is not None else None
    uid = _caller_uid(params)

    async def _op(session):
        return await set_group_quota(session, group_id, max_per_member, uid)

    group = await run_in_session(_op)
    return GroupResponse.model_validate(group)


# ── Quota rules (flexible per-member / per-pool caps) ──────────────────────


@register_command("groups_quota_rules_list", readonly=True)
async def cmd_groups_quota_rules_list(params: dict) -> QuotaRulesListResponse:
    """List the group's quota rules (any member) with current usage."""
    group_id = params["groupId"]
    uid = _caller_uid(params)

    async def _op(session):
        from stitch_backend.domains.groups.quota import RuleView, rule_usage

        rules = await list_quota_rules(session, group_id, uid)
        items = []
        for r in rules:
            resp = QuotaRuleResponse.model_validate(r)
            resp.used = await rule_usage(
                session,
                group_id=group_id,
                rule=RuleView(
                    subject=r.subject,
                    user_id=r.user_id,
                    model=r.model,
                    unit=r.unit,
                    amount=r.amount,
                    period=r.period,
                    rule_id=r.id,
                ),
            )
            items.append(resp)
        return items

    items = await run_in_read_session(_op)
    return QuotaRulesListResponse(rules=items)


@register_command("groups_quota_rule_set")
async def cmd_groups_quota_rule_set(params: dict) -> QuotaRuleResponse:
    """Create or update a quota rule (owner only, natural-key upsert).

    Params: ``subject`` ('member'|'pool'), ``userId`` (member rules only;
    null = every member), ``model`` (null = all models, 'prefix-*' glob),
    ``unit`` ('requests'|'tokens'), ``amount`` (null = unlimited),
    ``period`` ('daily'|'total').
    """
    group_id = params["groupId"]
    uid = _caller_uid(params)
    raw_user = params.get("userId")
    raw_amount = params.get("amount")

    async def _op(session):
        return await set_quota_rule(
            session,
            group_id,
            uid,
            subject=str(params.get("subject") or "member"),
            user_id=int(raw_user) if raw_user is not None else None,
            model=params.get("model"),
            unit=str(params.get("unit") or "requests"),
            amount=int(raw_amount) if raw_amount is not None else None,
            period=str(params.get("period") or "daily"),
        )

    rule = await run_in_session(_op)
    return QuotaRuleResponse.model_validate(rule)


@register_command("groups_quota_rule_delete")
async def cmd_groups_quota_rule_delete(params: dict) -> SuccessResponse:
    """Delete a quota rule (owner only)."""
    group_id = params["groupId"]
    rule_id = str(params["ruleId"])
    uid = _caller_uid(params)

    async def _op(session):
        return await delete_quota_rule(session, group_id, rule_id, uid)

    deleted = await run_in_session(_op)
    return SuccessResponse(success=deleted)


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


# ═══════════════════════════════════════════════════════════════════════════
# Account sharing (generic group_shares table, resource_type='account')
# ═══════════════════════════════════════════════════════════════════════════


@register_command("groups_share_account")
async def cmd_groups_share_account(params: dict) -> SuccessResponse:
    """Share an account into a group.

    Permission: allowed iff (caller is the account owner) OR (caller role
    is admin AND account.owner_id IS NULL); AND caller is a member of the
    group.  Error messages are human-readable strings.
    """
    account_id = str(params["accountId"])
    group_id = params["groupId"]
    uid = _caller_uid(params)
    caller_role = params.get("_caller_role")

    async def _op(session):
        # ── Fetch the account ──────────────────────────────────────────
        from sqlalchemy import select as sa_select

        from stitch_backend.domains.accounts.models import Account

        acc_result = await session.execute(
            sa_select(Account).where(Account.id == account_id)
        )
        account = acc_result.scalar_one_or_none()
        if account is None:
            raise StitchError(f"Account not found: {account_id}")

        # ── Permission: owner OR (admin AND legacy shared) ─────────────
        is_owner = uid is not None and account.owner_id == uid
        is_admin = caller_role == "admin"
        is_legacy_shared = account.owner_id is None

        if not (is_owner or (is_admin and is_legacy_shared)):
            raise StitchError(
                "Only the account owner can share it"
                if not is_legacy_shared
                else "Only the account owner or an admin can share a shared account"
            )

        # ── Caller must be a member of the group ───────────────────────
        if not await is_member(session, group_id, uid):
            raise StitchError("Not a member of this group")

        # ── Insert the share (idempotent) ──────────────────────────────
        await share_resource(
            session,
            group_id=group_id,
            resource_type="account",
            resource_id=account_id,
            shared_by=uid,
        )
        return True

    await run_in_session(_op)
    return SuccessResponse(success=True)


@register_command("groups_unshare_account")
async def cmd_groups_unshare_account(params: dict) -> SuccessResponse:
    """Unshare an account from a group.

    Permission: account owner OR shared_by==uid OR group role 'owner' OR
    instance admin.
    """
    account_id = str(params["accountId"])
    group_id = params["groupId"]
    uid = _caller_uid(params)
    caller_role = params.get("_caller_role")

    async def _op(session):
        from sqlalchemy import and_
        from sqlalchemy import select as sa_select

        from stitch_backend.domains.groups.models import GroupShare

        # ── Fetch the share row ────────────────────────────────────────
        share_result = await session.execute(
            sa_select(GroupShare).where(
                and_(
                    GroupShare.group_id == group_id,
                    GroupShare.resource_type == "account",
                    GroupShare.resource_id == account_id,
                )
            )
        )
        share = share_result.scalar_one_or_none()
        if share is None:
            # Idempotent: no-op when the share doesn't exist
            return True

        # ── Fetch the account (for owner check) ───────────────────────
        from stitch_backend.domains.accounts.models import Account

        acc_result = await session.execute(
            sa_select(Account).where(Account.id == account_id)
        )
        account = acc_result.scalar_one_or_none()

        # ── Permission checks ─────────────────────────────────────────
        is_account_owner = (
            uid is not None
            and account is not None
            and account.owner_id == uid
        )
        is_shared_by = uid is not None and share.shared_by == uid
        is_group_owner = await group_role(session, group_id, uid) == "owner"
        is_instance_admin = caller_role == "admin"

        if not (
            is_account_owner or is_shared_by or is_group_owner or is_instance_admin
        ):
            raise StitchError(
                "Only the account owner, the sharer, the group owner, or an admin can unshare"
            )

        await unshare_resource(
            session,
            group_id=group_id,
            resource_type="account",
            resource_id=account_id,
        )
        return True

    await run_in_session(_op)
    return SuccessResponse(success=True)


@register_command("groups_list_accounts", readonly=True)
async def cmd_groups_list_accounts(params: dict) -> list:
    """List accounts shared into a group (members only).

    Returns a list of GroupAccountItemResponse with camelCase wire-format
    keys: ``id, provider, email, status, quotaUsedPercent, ownerUsername,
    sharedByUsername, canRemoveShare, canDelete``.

    ``canRemoveShare``: account owner OR shared_by==uid OR group role
    'owner' OR instance admin.
    ``canDelete``: account owner OR group role 'owner' of any group the
    account is shared into OR desktop (uid None) OR shared (owner_id
    None) OR instance admin.
    """
    group_id = params["groupId"]
    uid = _caller_uid(params)
    caller_role = params.get("_caller_role")

    async def _op(session):
        # ── Members only ───────────────────────────────────────────────
        if not await is_member(session, group_id, uid):
            raise StitchError("Not a member of this group")

        # ── Fetch shared accounts + owner/sharer usernames in one query ─
        from sqlalchemy import and_
        from sqlalchemy import select as sa_select
        from sqlalchemy.orm import aliased

        from stitch_backend.domains.accounts.models import Account
        from stitch_backend.domains.auth.models import User
        from stitch_backend.domains.groups.models import GroupShare

        owner_user = aliased(User)
        sharer_user = aliased(User)

        stmt = (
            sa_select(
                Account,
                owner_user.username.label("owner_username"),
                GroupShare.shared_by,
                sharer_user.username.label("shared_by_username"),
            )
            .select_from(Account)
            .join(
                GroupShare,
                and_(
                    GroupShare.resource_type == "account",
                    # Both columns are TEXT — like-with-like comparison.
                    GroupShare.resource_id == Account.id,
                    GroupShare.group_id == group_id,
                ),
            )
            .outerjoin(owner_user, owner_user.id == Account.owner_id)
            .outerjoin(sharer_user, sharer_user.id == GroupShare.shared_by)
            .order_by(Account.created_at.desc())
        )
        result = await session.execute(stmt)
        rows = result.all()

        if not rows:
            return []

        # ── Caller's role in THIS group ────────────────────────────────
        caller_role_in_group = await group_role(session, group_id, uid)

        items: list[GroupAccountItemResponse] = []
        for account, owner_username, shared_by, shared_by_username in rows:
            # ── Quota percent ──────────────────────────────────────────
            used = account.quota_used or 0
            limit = account.quota_limit or 0
            quota_percent = (used / limit * 100) if limit > 0 else 0.0

            # ── Permission flags ───────────────────────────────────────
            is_account_owner = uid is not None and account.owner_id == uid
            is_shared_by = uid is not None and shared_by == uid
            is_group_owner = caller_role_in_group == "owner"
            is_instance_admin = caller_role == "admin"

            can_remove_share = (
                is_account_owner
                or is_shared_by
                or is_group_owner
                or is_instance_admin
            )

            # can_delete: extended rule — also allow group owners of ANY
            # group the account is shared into (not just this group).
            if uid is None:
                can_delete = True
            elif account.owner_id is None:
                can_delete = True
            elif account.owner_id == uid:
                can_delete = True
            elif is_instance_admin:
                can_delete = True
            else:
                can_delete = await is_group_owner_of_resource(
                    session,
                    resource_type="account",
                    resource_id=str(account.id),
                    uid=uid,
                )

            items.append(
                GroupAccountItemResponse(
                    id=str(account.id),
                    provider=account.provider,
                    email=account.email,
                    status=account.status,
                    quota_used_percent=quota_percent,
                    owner_username=owner_username,
                    shared_by_username=shared_by_username,
                    can_remove_share=can_remove_share,
                    can_delete=can_delete,
                )
            )
        return items

    return await run_in_read_session(_op)
