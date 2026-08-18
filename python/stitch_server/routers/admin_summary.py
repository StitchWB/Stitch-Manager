"""GET /admin/report-summary — aggregated report counts (plan §6 Phase 4).

Returns reports grouped by (plugin_id, version, step) within a time
window, sorted most-failing first. Protected by X-Admin-Key like the
other /admin/* routes (mirrors routers/admin.py).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002 — FastAPI resolves at runtime

from stitch_server.aggregation import AggregationResult, aggregate_reports
from stitch_server.auth import require_admin
from stitch_server.config import get_settings
from stitch_server.db import get_db

router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


@router.get("/report-summary", response_model=AggregationResult)
async def report_summary(
    db: Annotated[AsyncSession, Depends(get_db)],
    window_hours: Annotated[int | None, Query(ge=1)] = None,
) -> AggregationResult:
    """Aggregated report counts within the last ``window_hours``.

    Defaults to STITCH_SERVER_ALERT_WINDOW_HOURS (24). Groups are sorted
    by count descending (most-failing first).
    """
    hours = (
        window_hours
        if window_hours is not None
        else get_settings().alert_window_hours
    )
    return await aggregate_reports(db, hours)
