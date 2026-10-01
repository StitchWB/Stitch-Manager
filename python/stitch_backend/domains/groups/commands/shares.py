"""Account-sharing command handlers (group_shares, resource_type='account')."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.core.command_decorator import command
from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_session
from stitch_backend.domains.groups.commands._common import _caller_uid
from stitch_backend.domains.groups.schemas import (
    GroupAccountItemResponse,
    SuccessResponse,
)
from stitch_backend.domains.groups.service import (
    group_role,
    is_group_owner_of_resource,
    is_member,
    share_resource,
    unshare_resource,
)


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
        from sqlalchemy import select as sa_select

        from stitch_backend.domains.accounts.models import Account

        acc_result = await session.execute(
            sa_select(Account).where(Account.id == account_id)
        )
        account = acc_result.scalar_one_or_none()
        if account is None:
            raise StitchError(f"Account not found: {account_id}")

        is_owner = uid is not None and account.owner_id == uid
        is_admin = caller_role == "admin"
        is_legacy_shared = account.owner_id is None

        if not (is_owner or (is_admin and is_legacy_shared)):
            raise StitchError(
                "Only the account owner can share it"
                if not is_legacy_shared
                else "Only the account owner or an admin can share a shared account"
            )

        if not await is_member(session, group_id, uid):
            raise StitchError("Not a member of this group")

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

        from stitch_backend.domains.accounts.models import Account

        acc_result = await session.execute(
            sa_select(Account).where(Account.id == account_id)
        )
        account = acc_result.scalar_one_or_none()

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


@command("groups_list_accounts", readonly=True)
async def cmd_groups_list_accounts(db: AsyncSession, params: dict) -> list:
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

    if not await is_member(db, group_id, uid):
        raise StitchError("Not a member of this group")

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
    result = await db.execute(stmt)
    rows = result.all()

    if not rows:
        return []

    caller_role_in_group = await group_role(db, group_id, uid)

    items: list[GroupAccountItemResponse] = []
    for account, owner_username, shared_by, shared_by_username in rows:
        used = account.quota_used or 0
        limit = account.quota_limit or 0
        quota_percent = (used / limit * 100) if limit > 0 else 0.0

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
                db,
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
