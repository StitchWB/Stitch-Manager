"""Write path and retention for ``ai_proxy_request_logs``.

One row per client request, written once by the executor or the stream
completion callback through ``persist_request_log``.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, Literal

from sqlalchemy import delete, select

from stitch_backend.domains.ai_proxy.cost_tracker import get_cost_tracker
from stitch_backend.domains.ai_proxy.models import AiProxyRequestLog

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

RETENTION_DAYS = 30

RequestStatus = Literal["success", "error"]


async def record_request_log(
    session: AsyncSession,
    *,
    model: str,
    upstream_model: str,
    credential_id: str,
    status: RequestStatus,
    input_tokens: int,
    output_tokens: int,
    latency_ms: float,
    owner_id: int | None = None,
    failover_count: int = 0,
    error_class: str | None = None,
) -> None:
    """Insert one usage row into the caller's session; the caller commits."""
    session.add(AiProxyRequestLog(
        model=model,
        upstream_model=upstream_model,
        credential_id=credential_id,
        owner_id=owner_id,
        status=status,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        tokens_used=input_tokens + output_tokens,
        estimated_cost=get_cost_tracker().estimate_cost(
            upstream_model, input_tokens, output_tokens,
        ),
        latency_ms=latency_ms,
        failover_count=failover_count,
        error_class=error_class,
    ))
    await session.flush()


async def persist_request_log(
    run_in_session: Callable[..., Awaitable[Any]],
    *,
    model: str,
    upstream_model: str,
    credential_id: str,
    status: RequestStatus,
    input_tokens: int,
    output_tokens: int,
    latency_ms: float,
    owner_id: int | None = None,
    failover_count: int = 0,
    error_class: str | None = None,
) -> None:
    """Write one row in its own write session; failures never reach the caller."""
    async def _write(session: AsyncSession) -> None:
        await record_request_log(
            session,
            model=model,
            upstream_model=upstream_model,
            credential_id=credential_id,
            status=status,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
            owner_id=owner_id,
            failover_count=failover_count,
            error_class=error_class,
        )
    try:
        await run_in_session(_write)
    except Exception:
        logger.warning("Failed to record request log", exc_info=True)


async def prune_request_logs(
    session: AsyncSession,
    *,
    retention_days: int = RETENTION_DAYS,
    batch_size: int = 1000,
) -> int:
    """Delete rows older than ``retention_days`` in bounded batches."""
    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    removed_total = 0
    while True:
        stale_ids = (
            select(AiProxyRequestLog.id)
            .where(AiProxyRequestLog.created_at < cutoff)
            .limit(batch_size)
        )
        result = await session.execute(
            delete(AiProxyRequestLog).where(AiProxyRequestLog.id.in_(stale_ids)),
        )
        await session.flush()
        removed = int(getattr(result, "rowcount", 0) or 0)
        removed_total += removed
        if removed < batch_size:
            return removed_total
