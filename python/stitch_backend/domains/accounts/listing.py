"""Account listing query leaf for AccountService."""


from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import or_, select

from stitch_backend.domains.accounts.helpers import _to_response
from stitch_backend.domains.accounts.models import Account

if TYPE_CHECKING:
    from stitch_backend.domains.accounts.schemas import AccountResponse
    from stitch_backend.domains.accounts.service import AccountService


async def list_accounts(
    self: AccountService,
    provider: str | None = None,
    provider_type: str | None = None,
    provider_subtype: str | None = None,
    show_archived: bool = False,
    owner_id: int | None = None,
    caller_uid: int | None = None,
) -> list[AccountResponse]:
    """Unified listing: supports provider filter and archive visibility.

    When *owner_id* is supplied, only legacy shared rows (owner_id IS
    NULL) and rows owned by *owner_id* are returned (per-user
    isolation).  When *owner_id* is None (desktop / unauthenticated),
    only shared rows are returned.

    When *caller_uid* is given, additive ``mine`` and ``shared``
    fields are set on each response.

    When *caller_uid* is given, visibility is ALSO extended to include
    accounts shared into any group where the caller is a member (via
    the ``group_shares`` table).  Each visible account also gets
    ``group_ids`` and ``group_names`` populated — listing only the
    groups the caller is a member of (to avoid leaking group
    existence).  Guest (caller None) behavior is unchanged: shared
    pool only, no group fields.
    """
    stmt = select(Account).order_by(Account.created_at.desc())
    effective_provider = provider or provider_type or provider_subtype
    if effective_provider:
        stmt = stmt.where(Account.provider == effective_provider)
    if not show_archived:
        stmt = stmt.where(Account.status != "archived")

    if caller_uid is not None:
        # Visibility: shared (NULL), owned by caller, or shared into a group the caller belongs to.
        from sqlalchemy import and_
        from sqlalchemy import select as sa_select

        from stitch_backend.domains.groups.models import GroupMember, GroupShare

        member_group_ids_subq = (
            sa_select(GroupMember.group_id)
            .where(GroupMember.user_id == caller_uid)
            .scalar_subquery()
        )
        # Account.id and GroupShare.resource_id are both TEXT — the subquery compares like with like.
        shared_account_ids_subq = (
            sa_select(GroupShare.resource_id)
            .where(
                and_(
                    GroupShare.resource_type == "account",
                    GroupShare.group_id.in_(member_group_ids_subq),
                )
            )
            .scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                Account.owner_id.is_(None),
                Account.owner_id == owner_id,
                Account.id.in_(shared_account_ids_subq),
            )
        )
    else:
        # Guest/desktop: shared pool (NULL) or owned by caller (None caller matches NULL only).
        stmt = stmt.where(
            or_(Account.owner_id.is_(None), Account.owner_id == owner_id)
        )

    result = await self._db.execute(stmt)
    accounts = result.scalars().all()

    if caller_uid is None or not accounts:
        return [_to_response(a, caller_uid=caller_uid) for a in accounts]

    # Only groups where the caller is a member are included, to avoid leaking group existence.
    from stitch_backend.domains.groups.service import (
        group_ids_for_user,
        resource_shares,
    )

    member_group_ids = set(await group_ids_for_user(self._db, caller_uid))
    account_ids = [str(a.id) for a in accounts]
    shares = await resource_shares(
        self._db, resource_type="account", resource_ids=account_ids
    )

    responses: list[AccountResponse] = []
    for a in accounts:
        acct_shares = shares.get(str(a.id), [])
        filtered = [
            (gid, gname)
            for gid, gname, _sby in acct_shares
            if gid in member_group_ids
        ]
        responses.append(
            _to_response(
                a,
                caller_uid=caller_uid,
                group_ids=[gid for gid, _ in filtered if gid is not None],
                group_names=[gname for _, gname in filtered if gname is not None],
            )
        )
    return responses
