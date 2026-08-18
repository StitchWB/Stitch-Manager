"""Admin monitoring endpoints: bot heartbeat intake + aggregated snapshot.

Both routes require the ``X-Admin-Key`` header (router-level dependency,
same convention as the other /admin/* routers).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from stitch_server import monitoring
from stitch_server.auth import require_admin

router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


class HeartbeatRequest(BaseModel):
    """Body of POST /admin/bot-heartbeat (sent by stitch_bot)."""

    route: str | None = None
    candidates: list[str] = Field(default_factory=list)
    polling_errors: int = 0
    uptime_s: float = 0.0


@router.post("/bot-heartbeat")
async def bot_heartbeat(payload: HeartbeatRequest) -> dict[str, bool]:
    """Record a bot liveness heartbeat."""
    monitoring.record_heartbeat(payload.model_dump())
    return {"ok": True}


@router.get("/monitoring")
async def get_monitoring() -> dict[str, Any]:
    """Aggregated health snapshot for the admin UI."""
    return monitoring.get_snapshot()
