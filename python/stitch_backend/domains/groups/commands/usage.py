"""Usage-accounting and quota command handlers."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.core.command_decorator import command
from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session
from stitch_backend.domains.groups.commands._common import _caller_uid
from stitch_backend.domains.groups.schemas import (
    GroupResponse,
    QuotaRuleResponse,
    QuotaRulesListResponse,
    SuccessResponse,
    UsageListResponse,
)
from stitch_backend.domains.groups.service import (
    delete_quota_rule,
    list_group_usage,
    list_quota_rules,
    set_group_quota,
    set_quota_rule,
)


@command("groups_usage_list", readonly=True)
async def cmd_groups_usage_list(db: AsyncSession, params: dict) -> UsageListResponse:
    """List per-member usage for the last 30 days (members: own; owner: all).

    Returns rows + ``max_per_member_daily`` (the group-wide cap) so members
    can see the fair-use limit context.
    """
    group_id = params["groupId"]
    uid = _caller_uid(params)

    result = await list_group_usage(db, group_id, uid)

    return UsageListResponse(**result)


@command("groups_set_quota")
async def cmd_groups_set_quota(db: AsyncSession, params: dict) -> GroupResponse:
    """Set the per-member daily request cap (owner only; null=unlimited).

    Legacy single-cap API — kept for backward compatibility; evaluated as
    the lowest-priority member rule.  New code should use
    ``groups_quota_rule_set``.
    """
    group_id = params["groupId"]
    raw = params.get("maxPerMemberDaily")
    max_per_member = int(raw) if raw is not None else None
    uid = _caller_uid(params)

    group = await set_group_quota(db, group_id, max_per_member, uid)

    return GroupResponse.model_validate(group)


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


@command("groups_quota_rule_set")
async def cmd_groups_quota_rule_set(db: AsyncSession, params: dict) -> QuotaRuleResponse:
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

    rule = await set_quota_rule(
        db,
        group_id,
        uid,
        subject=str(params.get("subject") or "member"),
        user_id=int(raw_user) if raw_user is not None else None,
        model=params.get("model"),
        unit=str(params.get("unit") or "requests"),
        amount=int(raw_amount) if raw_amount is not None else None,
        period=str(params.get("period") or "daily"),
    )

    return QuotaRuleResponse.model_validate(rule)


@command("groups_quota_rule_delete")
async def cmd_groups_quota_rule_delete(db: AsyncSession, params: dict) -> SuccessResponse:
    """Delete a quota rule (owner only)."""
    group_id = params["groupId"]
    rule_id = str(params["ruleId"])
    uid = _caller_uid(params)

    deleted = await delete_quota_rule(db, group_id, rule_id, uid)

    return SuccessResponse(success=deleted)
