"""Quota rule resolution + usage aggregation for group pools.

Rule model (see :class:`~stitch_backend.domains.groups.models.GroupQuotaRule`):

- ``subject='member'`` — per-member cap; ``user_id NULL`` = every member.
  Among applicable member rules the MOST SPECIFIC one wins
  (user+exact-model > user+glob > user+all > default+... ).  A rule with
  ``amount NULL`` is an explicit "unlimited" override.
- ``subject='pool'`` — shared group-wide cap over ALL members' combined
  usage.  Every matching pool rule applies independently (a request is
  blocked when ANY of them is exceeded).

The legacy ``groups.max_requests_per_member_daily`` column is evaluated
as a synthetic lowest-priority member rule
``(member, user=NULL, model=NULL, requests, daily)`` so old groups keep
working without a data migration.
"""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

from sqlalchemy import func, select

from stitch_backend.domains.groups.models import (
    Group,
    GroupQuotaRule,
    GroupUsageByModel,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

Subject = Literal["member", "pool"]
Unit = Literal["requests", "tokens"]
Period = Literal["daily", "total"]

VALID_SUBJECTS = ("member", "pool")
VALID_UNITS = ("requests", "tokens")
VALID_PERIODS = ("daily", "total")


@dataclass(frozen=True)
class RuleView:
    """Evaluation-ready view of a quota rule (ORM row or synthetic legacy)."""

    subject: str
    user_id: int | None
    model: str | None
    unit: str
    amount: int | None
    period: str
    rule_id: str | None = None


@dataclass(frozen=True)
class QuotaVerdict:
    """Result of a quota evaluation for one (group, user, model)."""

    over: bool
    hit: RuleView | None = None


def matches_model(pattern: str | None, model: str) -> bool:
    """True when *pattern* (NULL / exact / ``'prefix-*'`` glob) covers *model*."""
    if pattern is None:
        return True
    if pattern.endswith("*"):
        return fnmatch.fnmatchcase(model, pattern)
    return pattern == model


def _model_like(column: Any, pattern: str) -> Any:
    """SQL LIKE predicate for a ``'prefix-*'`` glob — ``%``/``_``/``\\``
    inside the prefix are escaped so they stay literal (fnmatch treats
    them literally; without escaping, LIKE would not)."""
    prefix = (
        pattern[:-1]
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )
    return column.like(f"{prefix}%", escape="\\")


async def rules_for_group(db: AsyncSession, group: Group) -> list[RuleView]:
    """Load all rules for *group*, appending the legacy column as a rule."""
    result = await db.execute(
        select(GroupQuotaRule).where(GroupQuotaRule.group_id == group.id)
    )
    rules = [_rule_to_view(r) for r in result.scalars().all()]
    _append_legacy_rule(rules, group)
    return rules


def _rule_to_view(r: GroupQuotaRule) -> RuleView:
    return RuleView(
        subject=r.subject,
        user_id=r.user_id,
        model=r.model,
        unit=r.unit,
        amount=r.amount,
        period=r.period,
        rule_id=r.id,
    )


def _append_legacy_rule(rules: list[RuleView], group: Group) -> None:
    """The legacy ``max_requests_per_member_daily`` column acts as a
    lowest-priority member rule, so old groups keep working unchanged."""
    if group.max_requests_per_member_daily is not None:
        rules.append(
            RuleView(
                subject="member",
                user_id=None,
                model=None,
                unit="requests",
                amount=group.max_requests_per_member_daily,
                period="daily",
            )
        )


async def rules_for_groups(
    db: AsyncSession, groups: list[Group]
) -> dict[str, list[RuleView]]:
    """Batch variant of :func:`rules_for_group` — one query for all groups."""
    ids = [g.id for g in groups]
    if not ids:
        return {}
    result = await db.execute(
        select(GroupQuotaRule).where(GroupQuotaRule.group_id.in_(ids))
    )
    by_group: dict[str, list[RuleView]] = {gid: [] for gid in ids}
    for r in result.scalars().all():
        by_group.setdefault(r.group_id, []).append(_rule_to_view(r))
    for g in groups:
        _append_legacy_rule(by_group[g.id], g)
    return by_group


def _member_rule_applicable(rule: RuleView, user_id: int, model: str) -> bool:
    if rule.subject != "member":
        return False
    if rule.user_id is not None and rule.user_id != user_id:
        return False
    return matches_model(rule.model, model)


def _specificity(rule: RuleView, user_id: int, model: str) -> tuple[int, int]:
    user_score = 1 if rule.user_id is not None else 0
    if rule.model is None:
        model_score = 0
    elif rule.model.endswith("*"):
        model_score = 1
    else:
        model_score = 2
    return (user_score, model_score)


def resolve_member_rule(
    rules: list[RuleView], user_id: int, model: str
) -> RuleView | None:
    """Return the single most-specific applicable member rule, or None."""
    applicable = [
        (_specificity(r, user_id, model), r)
        for r in rules
        if _member_rule_applicable(r, user_id, model)
    ]
    if not applicable:
        return None
    # Highest specificity first; tie → finite amount before unlimited,
    # then the smaller amount (stricter wins, deterministic).
    applicable.sort(
        key=lambda pair: (
            -pair[0][0],
            -pair[0][1],
            pair[1].amount is None,
            pair[1].amount if pair[1].amount is not None else 0,
        )
    )
    return applicable[0][1]


def matching_pool_rules(rules: list[RuleView], model: str) -> list[RuleView]:
    """All pool rules covering *model* — each is an independent cap."""
    return [
        r
        for r in rules
        if r.subject == "pool" and matches_model(r.model, model)
    ]


async def usage_amount(
    db: AsyncSession,
    *,
    group_id: str,
    user_id: int | None,
    model_pattern: str | None,
    period: str,
    unit: str,
    today: str,
) -> int:
    """SUM over ``group_usage_by_model`` for the rule's scope.

    ``user_id=None`` aggregates the whole pool; ``model_pattern=None``
    aggregates all models; ``period='total'`` ignores the day.
    """
    column = (
        GroupUsageByModel.requests if unit == "requests"
        else GroupUsageByModel.tokens
    )
    stmt = (
        select(func.coalesce(func.sum(column), 0))
        .where(GroupUsageByModel.group_id == group_id)
    )
    if user_id is not None:
        stmt = stmt.where(GroupUsageByModel.user_id == user_id)
    if model_pattern is not None:
        if model_pattern.endswith("*"):
            stmt = stmt.where(_model_like(GroupUsageByModel.model, model_pattern))
        else:
            stmt = stmt.where(GroupUsageByModel.model == model_pattern)
    if period == "daily":
        stmt = stmt.where(GroupUsageByModel.day == today)
    result = await db.execute(stmt)
    return int(result.scalar_one())


async def evaluate_quota(
    db: AsyncSession,
    *,
    group: Group,
    user_id: int,
    model: str,
    rules: list[RuleView] | None = None,
    today: str | None = None,
) -> QuotaVerdict:
    """Evaluate member + pool rules for one (group, user, model)."""
    if rules is None:
        rules = await rules_for_group(db, group)
    if today is None:
        today = datetime.now(UTC).strftime("%Y-%m-%d")

    member_rule = resolve_member_rule(rules, user_id, model)
    if member_rule is not None and member_rule.amount is not None:
        used = await usage_amount(
            db,
            group_id=group.id,
            user_id=user_id,
            model_pattern=member_rule.model,
            period=member_rule.period,
            unit=member_rule.unit,
            today=today,
        )
        if used >= member_rule.amount:
            return QuotaVerdict(over=True, hit=member_rule)

    for pool_rule in matching_pool_rules(rules, model):
        if pool_rule.amount is None:
            continue
        used = await usage_amount(
            db,
            group_id=group.id,
            user_id=None,
            model_pattern=pool_rule.model,
            period=pool_rule.period,
            unit=pool_rule.unit,
            today=today,
        )
        if used >= pool_rule.amount:
            return QuotaVerdict(over=True, hit=pool_rule)

    return QuotaVerdict(over=False)


async def over_quota_groups(
    db: AsyncSession,
    *,
    group_ids: list[str] | tuple[str, ...],
    user_id: int,
    model: str,
) -> set[str]:
    """Return the subset of *group_ids* over quota for (user_id, model).

    Groups and their rules are batch-loaded (2 queries total); per-rule
    usage aggregation is the only per-rule query left.
    """
    if not group_ids:
        return set()
    result = await db.execute(select(Group).where(Group.id.in_(list(group_ids))))
    groups = list(result.scalars().all())
    rules_map = await rules_for_groups(db, groups)
    over: set[str] = set()
    for group in groups:
        verdict = await evaluate_quota(
            db,
            group=group,
            user_id=user_id,
            model=model,
            rules=rules_map.get(group.id, []),
        )
        if verdict.over:
            over.add(group.id)
    return over


async def rule_usage(
    db: AsyncSession,
    *,
    group_id: str,
    rule: RuleView,
    today: str | None = None,
) -> int:
    """Current usage counter for a rule — for progress display.

    Member rule with ``user_id`` → that member's usage.  Member rule with
    ``user_id=None`` → the MAX across members (the member closest to the
    cap).  Pool rule → the whole group's combined usage.
    """
    if today is None:
        today = datetime.now(UTC).strftime("%Y-%m-%d")
    if rule.subject == "member" and rule.user_id is None:
        column = (
            GroupUsageByModel.requests if rule.unit == "requests"
            else GroupUsageByModel.tokens
        )
        stmt = (
            select(func.coalesce(func.sum(column), 0).label("used"))
            .where(GroupUsageByModel.group_id == group_id)
            .group_by(GroupUsageByModel.user_id)
        )
        if rule.model is not None:
            if rule.model.endswith("*"):
                stmt = stmt.where(_model_like(GroupUsageByModel.model, rule.model))
            else:
                stmt = stmt.where(GroupUsageByModel.model == rule.model)
        if rule.period == "daily":
            stmt = stmt.where(GroupUsageByModel.day == today)
        result = await db.execute(stmt)
        per_user = [int(row.used) for row in result.all()]
        return max(per_user, default=0)
    return await usage_amount(
        db,
        group_id=group_id,
        user_id=rule.user_id if rule.subject == "member" else None,
        model_pattern=rule.model,
        period=rule.period,
        unit=rule.unit,
        today=today,
    )
