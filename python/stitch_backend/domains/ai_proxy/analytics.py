"""Aggregation queries on ``ai_proxy_request_logs``.

One row per client request, written by ``request_logs.persist_request_log``.
Return shapes mirror the frontend types ``DailyStats``, ``DailyStatsPoint``
and ``ModelUsage`` in ``src/types/generated.ts``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, TypedDict

from sqlalchemy import case, func, select

from stitch_backend.domains.ai_proxy.models import AiProxyRequestLog

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class DailyStats(TypedDict):
    totalRequests: int
    successfulRequests: int
    failedRequests: int
    totalTokens: int
    avgDurationMs: float


class DailyStatsPoint(TypedDict):
    date: str
    requests: int
    successful: int
    failed: int


class ModelUsage(TypedDict):
    model: str
    requests: int
    tokens: int


def _today_start() -> datetime:
    now = datetime.now(UTC)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _since(days: int) -> datetime:
    return datetime.now(UTC) - timedelta(days=days)


def _scope(since: datetime, owner_id: int | None) -> list[Any]:
    conditions: list[Any] = [AiProxyRequestLog.created_at >= since]
    if owner_id is not None:
        conditions.append(AiProxyRequestLog.owner_id == owner_id)
    return conditions


_SUCCESSES = func.coalesce(
    func.sum(case((AiProxyRequestLog.status == "success", 1), else_=0)), 0,
)
_FAILURES = func.coalesce(
    func.sum(case((AiProxyRequestLog.status == "error", 1), else_=0)), 0,
)


class AiProxyAnalytics:
    """Aggregation queries on request logs."""

    @classmethod
    async def get_daily_stats(
        cls, session: AsyncSession, *, owner_id: int | None = None,
    ) -> DailyStats:
        stmt = select(
            func.count().label("total_requests"),
            _SUCCESSES.label("successful_requests"),
            _FAILURES.label("failed_requests"),
            func.coalesce(func.sum(AiProxyRequestLog.tokens_used), 0).label("total_tokens"),
            func.coalesce(func.avg(AiProxyRequestLog.latency_ms), 0.0).label("avg_duration_ms"),
        ).where(*_scope(_today_start(), owner_id))
        row = (await session.execute(stmt)).mappings().one()
        return DailyStats(
            totalRequests=row["total_requests"],
            successfulRequests=row["successful_requests"],
            failedRequests=row["failed_requests"],
            totalTokens=row["total_tokens"],
            avgDurationMs=float(row["avg_duration_ms"]),
        )

    @classmethod
    async def get_model_usage(
        cls, session: AsyncSession, *, owner_id: int | None = None,
    ) -> list[ModelUsage]:
        requests = func.count().label("requests")
        stmt = (
            select(
                AiProxyRequestLog.model.label("model"),
                requests,
                func.coalesce(func.sum(AiProxyRequestLog.tokens_used), 0).label("tokens"),
            )
            .where(*_scope(_since(7), owner_id))
            .group_by(AiProxyRequestLog.model)
            .order_by(requests.desc())
            .limit(50)
        )
        rows = (await session.execute(stmt)).mappings().all()
        return [
            ModelUsage(model=r["model"], requests=r["requests"], tokens=r["tokens"])
            for r in rows
        ]

    @classmethod
    async def get_cost_estimate(
        cls, session: AsyncSession, *, owner_id: int | None = None,
    ) -> float:
        stmt = select(
            func.coalesce(func.sum(AiProxyRequestLog.estimated_cost), 0.0),
        ).where(*_scope(_since(30), owner_id))
        total = (await session.execute(stmt)).scalar_one()
        return float(total)

    @classmethod
    async def get_weekly_stats(
        cls, session: AsyncSession, *, owner_id: int | None = None,
    ) -> list[DailyStatsPoint]:
        day = func.date(AiProxyRequestLog.created_at).label("day")
        stmt = (
            select(
                day,
                func.count().label("requests"),
                _SUCCESSES.label("successful"),
                _FAILURES.label("failed"),
            )
            .where(*_scope(_since(7), owner_id))
            .group_by(day)
            .order_by(day)
        )
        rows = (await session.execute(stmt)).mappings().all()
        return [
            DailyStatsPoint(
                date=r["day"],
                requests=r["requests"],
                successful=r["successful"],
                failed=r["failed"],
            )
            for r in rows
        ]
