"""Usage accounting and quota rules."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import and_, delete, select

from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.auth.models import User
from stitch_backend.domains.groups.membership import get_group, is_member
from stitch_backend.domains.groups.models import (
    GroupQuotaRule,
    GroupUsageByModel,
    _utcnow,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from stitch_backend.domains.groups.models import Group


async def list_group_usage(
    db: AsyncSession, group_id: str, uid: int | None
) -> dict:
    """Return per-member usage rows for the last 30 days + the group cap.

    Members see only their own rows; owners see all members' rows.
    Single query joins ``group_usage`` with ``auth_users`` for usernames.
    The response includes ``max_per_member_daily`` (the group-wide cap,
    nullable = unlimited) so members can see the fair-use limit context.
    """
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if not await is_member(db, group_id, uid):
        raise StitchError("Not a member of this group")

    is_owner = uid is not None and group.owner_id == uid
    # SQLite string comparison on 'YYYY-MM-DD' works for date ordering.
    cutoff_day = (datetime.now(UTC) - timedelta(days=30)).strftime("%Y-%m-%d")

    stmt = (
        select(
            GroupUsageByModel.user_id,
            User.username,
            GroupUsageByModel.model,
            GroupUsageByModel.day,
            GroupUsageByModel.requests,
            GroupUsageByModel.tokens,
        )
        .join(User, User.id == GroupUsageByModel.user_id)
        .where(
            GroupUsageByModel.group_id == group_id,
            GroupUsageByModel.day >= cutoff_day,
        )
        .order_by(GroupUsageByModel.day.desc(), GroupUsageByModel.user_id)
    )
    if not is_owner:
        stmt = stmt.where(GroupUsageByModel.user_id == uid)

    result = await db.execute(stmt)
    rows = [
        {
            "user_id": row.user_id,
            "username": row.username,
            "model": row.model,
            "day": row.day,
            "requests": row.requests,
            "tokens": row.tokens,
        }
        for row in result.all()
    ]
    return {
        "rows": rows,
        "max_per_member_daily": group.max_requests_per_member_daily,
    }


async def set_group_quota(
    db: AsyncSession,
    group_id: str,
    max_per_member_daily: int | None,
    caller_uid: int | None,
) -> Group:
    """Owner sets the per-member daily request cap (NULL=unlimited).

    Legacy single-cap API — evaluated as the lowest-priority member rule
    (see :mod:`stitch_backend.domains.groups.quota`).  New code should
    prefer :func:`set_quota_rule`.
    """
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if caller_uid is None or group.owner_id != caller_uid:
        raise StitchError("Only the group owner can set the quota")
    if max_per_member_daily is not None and max_per_member_daily < 1:
        raise StitchError("Quota must be a positive integer or null")
    group.max_requests_per_member_daily = max_per_member_daily
    await db.flush()
    return group


async def list_quota_rules(
    db: AsyncSession, group_id: str, uid: int | None
) -> list[GroupQuotaRule]:
    """Any member can list the group's quota rules."""
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if not await is_member(db, group_id, uid):
        raise StitchError("Not a member of this group")
    result = await db.execute(
        select(GroupQuotaRule)
        .where(GroupQuotaRule.group_id == group_id)
        .order_by(GroupQuotaRule.created_at)
    )
    return list(result.scalars().all())


async def set_quota_rule(
    db: AsyncSession,
    group_id: str,
    caller_uid: int | None,
    *,
    subject: str,
    user_id: int | None = None,
    model: str | None = None,
    unit: str = "requests",
    amount: int | None = None,
    period: str = "daily",
) -> GroupQuotaRule:
    """Owner creates or updates a quota rule (natural-key upsert).

    The natural key is ``(group_id, subject, user_id, model, unit,
    period)`` — re-setting the same combination updates ``amount`` in
    place rather than creating a duplicate.
    """
    from stitch_backend.domains.groups.quota import (
        VALID_PERIODS,
        VALID_SUBJECTS,
        VALID_UNITS,
    )

    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if caller_uid is None or group.owner_id != caller_uid:
        raise StitchError("Only the group owner can set quota rules")
    if subject not in VALID_SUBJECTS:
        raise StitchError(f"subject must be one of {VALID_SUBJECTS}")
    if unit not in VALID_UNITS:
        raise StitchError(f"unit must be one of {VALID_UNITS}")
    if period not in VALID_PERIODS:
        raise StitchError(f"period must be one of {VALID_PERIODS}")
    if amount is not None and amount < 1:
        raise StitchError("amount must be a positive integer or null (unlimited)")
    if subject == "pool" and user_id is not None:
        raise StitchError("pool rules apply to the whole group — user_id must be null")
    model = model.strip() if model else None
    if model == "*":
        raise StitchError("model '*' is ambiguous — use null for all models")

    stmt = select(GroupQuotaRule).where(
        and_(
            GroupQuotaRule.group_id == group_id,
            GroupQuotaRule.subject == subject,
            GroupQuotaRule.unit == unit,
            GroupQuotaRule.period == period,
            (
                GroupQuotaRule.user_id == user_id
                if user_id is not None
                else GroupQuotaRule.user_id.is_(None)
            ),
            (
                GroupQuotaRule.model == model
                if model is not None
                else GroupQuotaRule.model.is_(None)
            ),
        )
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing is not None:
        existing.amount = amount
        await db.flush()
        return existing

    rule = GroupQuotaRule(
        group_id=group_id,
        subject=subject,
        user_id=user_id,
        model=model,
        unit=unit,
        amount=amount,
        period=period,
        created_at=_utcnow(),
    )
    db.add(rule)
    await db.flush()
    return rule


async def delete_quota_rule(
    db: AsyncSession, group_id: str, rule_id: str, caller_uid: int | None
) -> bool:
    """Owner deletes a quota rule."""
    group = await get_group(db, group_id)
    if group is None:
        raise StitchError("Group not found")
    if caller_uid is None or group.owner_id != caller_uid:
        raise StitchError("Only the group owner can delete quota rules")
    result = await db.execute(
        delete(GroupQuotaRule).where(
            and_(
                GroupQuotaRule.id == rule_id,
                GroupQuotaRule.group_id == group_id,
            )
        )
    )
    await db.flush()
    return bool(getattr(result, "rowcount", 0) or 0)
