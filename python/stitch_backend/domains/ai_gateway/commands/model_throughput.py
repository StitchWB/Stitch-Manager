from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from stitch_backend.core.command_decorator import command
from stitch_backend.domains.ai_gateway.model_throughput import (
    ModelThroughputRow,
    model_throughput_registry,
)
from stitch_backend.domains.ai_gateway.schemas.model_throughput import (
    ListModelThroughputRequest,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=UTC).isoformat()


def _shape(rows: list[ModelThroughputRow], limit: int) -> list[dict[str, Any]]:
    shaped = [
        {
            "model": row.model,
            "requests": row.requests,
            "promptTokens": row.prompt_tokens,
            "completionTokens": row.completion_tokens,
            "avgTps": round(row.avg_tps, 2),
            "p50Tps": round(row.p50_tps, 2),
            "maxTps": round(row.max_tps, 2),
            "lastUsedAt": _iso(row.last_used_at),
        }
        for row in rows
    ]
    return shaped[:limit] if limit > 0 else shaped


@command(
    "list_model_throughput",
    readonly=True,
    request=ListModelThroughputRequest,
    timeout=-1,
)
async def cmd_list_model_throughput(
    db: AsyncSession,
    req: ListModelThroughputRequest,
) -> dict:
    rows = model_throughput_registry.snapshot(window_minutes=req.window_minutes)
    shaped = _shape(rows, req.limit)
    return {"totalModels": len(rows), "count": len(shaped), "models": shaped}
