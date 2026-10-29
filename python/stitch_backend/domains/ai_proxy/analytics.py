"""Aggregation queries on ``ai_proxy_request_logs``."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text

# must stay "stitch_backend.domains.ai_proxy.service": logging config and tests address this logger by name
logger = logging.getLogger("stitch_backend.domains.ai_proxy.service")


class AiProxyAnalytics:
    """Aggregation queries on request logs."""

    @classmethod
    async def get_daily_stats(cls, session: Any) -> dict[str, Any]:
        try:
            result = await session.execute(text(
                "SELECT COUNT(*) as total_requests,"
                " COALESCE(SUM(tokens_used),0) as total_tokens,"
                " COALESCE(SUM(estimated_cost),0.0) as estimated_cost"
                " FROM ai_proxy_request_logs"
                " WHERE created_at >= strftime('%s','now','-1 day')"
            ))
            row = result.fetchone()
            return {
                "totalRequests": row.total_requests if row else 0,
                "totalTokens": row.total_tokens if row else 0,
                "estimatedCost": float(row.estimated_cost) if row else 0.0,
            }
        except Exception:
            logger.warning(
                "AiProxyAnalytics.get_daily_stats failed", exc_info=True,
            )
            return {"totalRequests": 0, "totalTokens": 0, "estimatedCost": 0.0}

    @classmethod
    async def get_model_usage(cls, session: Any) -> list[dict[str, Any]]:
        try:
            result = await session.execute(text(
                "SELECT model, COUNT(*) as requests, COALESCE(SUM(tokens_used),0) as tokens"
                " FROM ai_proxy_request_logs"
                " WHERE created_at >= strftime('%s','now','-7 days')"
                " GROUP BY model ORDER BY requests DESC LIMIT 50"
            ))
            return [
                {"model": r.model, "requests": r.requests, "tokens": r.tokens}
                for r in result.fetchall()
            ]
        except Exception:
            logger.warning(
                "AiProxyAnalytics.get_model_usage failed", exc_info=True,
            )
            return []

    @classmethod
    async def get_cost_estimate(cls, session: Any) -> float:
        try:
            result = await session.execute(text(
                "SELECT COALESCE(SUM(estimated_cost),0.0) as total"
                " FROM ai_proxy_request_logs"
                " WHERE created_at >= strftime('%s','now','-30 days')"
            ))
            row = result.fetchone()
            return float(row.total) if row else 0.0
        except Exception:
            logger.warning(
                "AiProxyAnalytics.get_cost_estimate failed", exc_info=True,
            )
            return 0.0

    @classmethod
    async def get_weekly_stats(cls, session: Any) -> list[dict[str, Any]]:
        try:
            result = await session.execute(text(
                "SELECT date(created_at, 'unixepoch') as day,"
                " COUNT(*) as requests, COALESCE(SUM(tokens_used),0) as tokens"
                " FROM ai_proxy_request_logs"
                " WHERE created_at >= strftime('%s','now','-7 days')"
                " GROUP BY day ORDER BY day"
            ))
            return [
                {"day": r.day, "requests": r.requests, "tokens": r.tokens}
                for r in result.fetchall()
            ]
        except Exception:
            logger.warning(
                "AiProxyAnalytics.get_weekly_stats failed", exc_info=True,
            )
            return []

    @classmethod
    async def get_daily_usage_by_account(cls, session: Any) -> list[dict[str, Any]]:
        try:
            result = await session.execute(text(
                "SELECT a.provider, a.name, COUNT(l.id) as requests,"
                " COALESCE(SUM(l.tokens_used),0) as tokens"
                " FROM ai_proxy_accounts a"
                " LEFT JOIN ai_proxy_request_logs l"
                "   ON l.account_id = a.id"
                "   AND l.created_at >= strftime('%s','now','-1 day')"
                " WHERE a.enabled = 1"
                " GROUP BY a.id ORDER BY requests DESC"
            ))
            return [
                {"provider": r.provider, "name": r.name, "requests": r.requests, "tokens": r.tokens}
                for r in result.fetchall()
            ]
        except Exception:
            logger.warning(
                "AiProxyAnalytics.get_daily_usage_by_account failed",
                exc_info=True,
            )
            return []
