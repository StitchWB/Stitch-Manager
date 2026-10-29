"""Analytics commands — daily/weekly stats, model usage, cost."""

from __future__ import annotations

from typing import TYPE_CHECKING

from stitch_backend.core.command_decorator import command
from stitch_backend.domains.ai_proxy.commands._common import _alias_owner_id

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@command("get_ai_proxy_account_daily_usage", readonly=True)
async def cmd_get_ai_proxy_account_daily_usage(db: AsyncSession, params: dict) -> list:
    from stitch_backend.domains.ai_proxy.legacy_accounts_api import list_accounts
    owner_id = _alias_owner_id(params)

    accounts = await list_accounts(db, owner_id=owner_id)
    return [
        {"provider": a["provider"], "name": a["name"], "requests": 0, "tokens": 0}
        for a in accounts
        if a.get("enabled")
    ]


@command("get_daily_stats", readonly=True)
async def cmd_get_daily_stats(db: AsyncSession, params: dict) -> dict:
    from stitch_backend.domains.ai_proxy.service import AiProxyAnalytics

    return await AiProxyAnalytics.get_daily_stats(db)


@command("get_model_usage", readonly=True)
async def cmd_get_model_usage(db: AsyncSession, params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import AiProxyAnalytics

    return await AiProxyAnalytics.get_model_usage(db)


@command("get_cost_estimate", readonly=True)
async def cmd_get_cost_estimate(db: AsyncSession, params: dict) -> float:
    from stitch_backend.domains.ai_proxy.service import AiProxyAnalytics

    return await AiProxyAnalytics.get_cost_estimate(db)


@command("get_weekly_stats", readonly=True)
async def cmd_get_weekly_stats(db: AsyncSession, params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import AiProxyAnalytics

    return await AiProxyAnalytics.get_weekly_stats(db)
