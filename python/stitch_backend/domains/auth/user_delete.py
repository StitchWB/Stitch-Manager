"""User-delete impact preview and the transfer-or-refuse rule.

Deleting a user CASCADE-deletes every group they own (members, invites,
quota rules and shares go with it) and SET-NULLs their accounts, AI
gateway credentials and provider endpoints into the instance-shared
pool.  This module makes that blast radius explicit: a preview the
admin can show before confirming, and a rule that refuses the delete —
or transfers ownership to a successor — before any of it happens.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel
from sqlalchemy import func, select, update

from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.accounts.models import Account
from stitch_backend.domains.ai_gateway.models import Credential, ProviderEndpoint
from stitch_backend.domains.auth import service as auth_service
from stitch_backend.domains.groups.lifecycle import transfer_ownership
from stitch_backend.domains.groups.models import Group, GroupMember

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class OwnedGroupImpact(BaseModel):
    """One group the target user owns, with its member count."""

    id: str
    name: str
    member_count: int


class UserDeleteImpact(BaseModel):
    """What deleting the user would destroy or move to the shared pool."""

    owned_groups: list[OwnedGroupImpact]
    owned_accounts: int
    owned_credentials: int
    owned_endpoints: int


class UserDeleteBlockedError(StitchError):
    """Delete refused under the transfer-or-refuse rule.

    Carries the impact payload so the API layer can return it with the
    409 response.
    """

    def __init__(self, message: str, *, impact: UserDeleteImpact) -> None:
        super().__init__(message)
        self.impact = impact


async def user_delete_impact(db: AsyncSession, user_id: int) -> UserDeleteImpact:
    """Blast radius of deleting *user_id*: owned groups with member
    counts, plus owned accounts / credentials / endpoints counts.
    """
    groups_result = await db.execute(
        select(
            Group.id,
            Group.name,
            func.count(GroupMember.user_id).label("member_count"),
        )
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(Group.owner_id == user_id)
        .group_by(Group.id, Group.name)
    )
    owned_groups = [
        OwnedGroupImpact(
            id=row.id, name=row.name, member_count=row.member_count
        )
        for row in groups_result.all()
    ]

    async def _owned_count(
        model: type[Account] | type[Credential] | type[ProviderEndpoint],
    ) -> int:
        result = await db.execute(
            select(func.count()).where(model.owner_id == user_id)
        )
        return int(result.scalar_one())

    return UserDeleteImpact(
        owned_groups=owned_groups,
        owned_accounts=await _owned_count(Account),
        owned_credentials=await _owned_count(Credential),
        owned_endpoints=await _owned_count(ProviderEndpoint),
    )


async def delete_user_guarded(
    db: AsyncSession, user_id: int, *, transfer_to: int | None
) -> None:
    """Delete *user_id* under the transfer-or-refuse rule.

    Without *transfer_to*: refused (:class:`UserDeleteBlockedError`)
    when the user owns a group with other members or any accounts /
    credentials / endpoints — those would be cascade-deleted or
    SET-NULLed into the instance-shared pool.  Owner-only groups
    cascade harmlessly and never block.

    With *transfer_to*: ownership of every owned group, account,
    credential and endpoint moves to that user first; then the delete
    proceeds.
    """
    impact = await user_delete_impact(db, user_id)

    if transfer_to is not None:
        if transfer_to == user_id:
            raise StitchError("transfer_to must be a different user")
        successor = await auth_service.get_user(db, transfer_to)
        if successor is None:
            raise StitchError(f"User not found: {transfer_to}")
        await _transfer_owned(db, user_id, transfer_to)
    else:
        blocking_groups = [g for g in impact.owned_groups if g.member_count > 1]
        if (
            blocking_groups
            or impact.owned_accounts
            or impact.owned_credentials
            or impact.owned_endpoints
        ):
            raise UserDeleteBlockedError(
                "Cannot delete: user owns groups with members or "
                "accounts/credentials; pass transfer_to to transfer ownership",
                impact=impact,
            )

    await auth_service.delete_user(db, user_id)


async def _transfer_owned(
    db: AsyncSession,
    user_id: int,
    transfer_to: int,
) -> None:
    """Move everything *user_id* owns to *transfer_to*.

    Groups: the successor is added as a member when not already one,
    then ``transfer_ownership`` swaps the roles (old owner → member,
    successor → owner) and updates ``groups.owner_id``.
    """
    groups_result = await db.execute(
        select(Group.id).where(Group.owner_id == user_id)
    )
    for group_id in groups_result.scalars():
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == transfer_to,
            )
        )
        if member_result.scalar_one_or_none() is None:
            db.add(
                GroupMember(
                    group_id=group_id,
                    user_id=transfer_to,
                    role="member",
                )
            )
            await db.flush()
        await transfer_ownership(db, group_id, transfer_to, user_id)

    await db.execute(
        update(Account)
        .where(Account.owner_id == user_id)
        .values(owner_id=transfer_to)
    )
    await db.execute(
        update(Credential)
        .where(Credential.owner_id == user_id)
        .values(owner_id=transfer_to)
    )
    await db.execute(
        update(ProviderEndpoint)
        .where(ProviderEndpoint.owner_id == user_id)
        .values(owner_id=transfer_to)
    )
    await db.flush()
