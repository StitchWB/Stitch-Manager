"""Generic resource shares (group_shares table)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import and_, delete, select

from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.groups.membership import get_group
from stitch_backend.domains.groups.models import (
    Group,
    GroupMember,
    GroupShare,
    _utcnow,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


async def share_resource(
    db: AsyncSession,
    *,
    group_id: str,
    resource_type: str,
    resource_id: str,
    shared_by: int | None,
) -> bool:
    """Share a resource into a group; idempotent.

    Inserts a ``group_shares`` row with ``(group_id, resource_type,
    resource_id)``.  If the row already exists (same triple), this is a
    no-op and returns ``True``.  ``shared_by`` is recorded on first
    insert only — a re-share by a different user does not overwrite the
    original sharer.
    """
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")

    existing_result = await db.execute(
        select(GroupShare).where(
            and_(
                GroupShare.group_id == group_id,
                GroupShare.resource_type == resource_type,
                GroupShare.resource_id == str(resource_id),
            )
        )
    )
    if existing_result.scalar_one_or_none() is not None:
        return True

    share = GroupShare(
        group_id=group_id,
        resource_type=resource_type,
        resource_id=str(resource_id),
        shared_by=shared_by,
        created_at=_utcnow(),
    )
    db.add(share)
    await db.flush()
    return True


async def unshare_resource(
    db: AsyncSession,
    *,
    group_id: str,
    resource_type: str,
    resource_id: str,
) -> bool:
    """Remove a resource share; idempotent.

    Deletes the ``group_shares`` row matching ``(group_id, resource_type,
    resource_id)``.  No-op (returns ``True``) when the share did not exist.
    """
    await db.execute(
        delete(GroupShare).where(
            and_(
                GroupShare.group_id == group_id,
                GroupShare.resource_type == resource_type,
                GroupShare.resource_id == str(resource_id),
            )
        )
    )
    await db.flush()
    return True


async def list_group_resources(
    db: AsyncSession,
    *,
    group_id: str,
    resource_type: str,
) -> list[str]:
    """Return the list of resource_ids shared into *group_id* of *resource_type*."""
    result = await db.execute(
        select(GroupShare.resource_id).where(
            and_(
                GroupShare.group_id == group_id,
                GroupShare.resource_type == resource_type,
            )
        )
    )
    return [row[0] for row in result.all()]


async def resource_shares(
    db: AsyncSession,
    *,
    resource_type: str,
    resource_ids: list[str],
) -> dict[str, list[tuple[str, str | None, int | None]]]:
    """Return ``resource_id → list[(group_id, group_name, shared_by)]``.

    Single join query over ``group_shares`` + ``groups``.  Resource IDs
    not present in any share map to an empty list.  Empty input → ``{}``.
    """
    if not resource_ids:
        return {}
    str_ids = [str(rid) for rid in resource_ids]
    result = await db.execute(
        select(
            GroupShare.resource_id,
            GroupShare.group_id,
            Group.name.label("group_name"),
            GroupShare.shared_by,
        )
        .select_from(GroupShare)
        .join(Group, Group.id == GroupShare.group_id)
        .where(
            and_(
                GroupShare.resource_type == resource_type,
                GroupShare.resource_id.in_(str_ids),
            )
        )
    )
    out: dict[str, list[tuple[str, str | None, int | None]]] = {
        rid: [] for rid in str_ids
    }
    for row in result.all():
        out.setdefault(row.resource_id, []).append(
            (row.group_id, row.group_name, row.shared_by)
        )
    return out


async def is_group_owner_of_resource(
    db: AsyncSession,
    *,
    resource_type: str,
    resource_id: str,
    uid: int | None,
) -> bool:
    """True when *uid* has role ``'owner'`` in any group the resource is shared into.

    Used by the extended account-delete permission rule.
    """
    if uid is None:
        return False
    result = await db.execute(
        select(GroupMember.group_id)
        .join(
            GroupShare,
            GroupShare.group_id == GroupMember.group_id,
        )
        .where(
            and_(
                GroupShare.resource_type == resource_type,
                GroupShare.resource_id == str(resource_id),
                GroupMember.user_id == uid,
                GroupMember.role == "owner",
            )
        )
    )
    return result.scalar_one_or_none() is not None
