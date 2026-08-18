"""Aggregation queries for stored reports (plan §6 Phase 4 telemetry).

Groups reports by (plugin_id, version, step) within a configurable time
window, returns counts sorted most-failing first. Used by the admin
report-summary endpoint and the threshold alert checker.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from pydantic import BaseModel
from sqlalchemy import func, select

from stitch_server.models import Report

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class ReportGroup(BaseModel):
    """A single (plugin_id, version, step) group with its report count."""

    plugin_id: str
    version: str
    step: str
    count: int


class PluginTotal(BaseModel):
    """Total report count for a single plugin_id (across versions/steps)."""

    plugin_id: str
    count: int


class AggregationResult(BaseModel):
    """Aggregated report counts within a time window.

    Returned by GET /admin/report-summary. ``groups`` is sorted by count
    descending (most-failing first); ``totals_per_plugin`` is the same but
    collapsed to plugin_id granularity.
    """

    window_hours: int
    groups: list[ReportGroup]
    total_reports: int
    totals_per_plugin: list[PluginTotal]


async def aggregate_reports(db: AsyncSession, window_hours: int) -> AggregationResult:
    """Group reports within the last ``window_hours`` by (plugin_id, version, step).

    Returns groups sorted by count descending (most-failing first), plus a
    total per plugin_id and the grand total.
    """
    cutoff = datetime.now(UTC) - timedelta(hours=window_hours)
    rows = (
        await db.execute(
            select(
                Report.plugin_id,
                Report.version,
                Report.step,
                func.count(Report.id).label("count"),
            )
            .where(Report.created_at >= cutoff)
            .group_by(Report.plugin_id, Report.version, Report.step)
            .order_by(func.count(Report.id).desc())
        )
    ).all()
    groups = [
        ReportGroup(
            plugin_id=row.plugin_id,
            version=row.version,
            step=row.step,
            count=row.count,
        )
        for row in rows
    ]
    # Derive per-plugin totals from the grouped rows (avoids a second query).
    per_plugin: dict[str, int] = {}
    for g in groups:
        per_plugin[g.plugin_id] = per_plugin.get(g.plugin_id, 0) + g.count
    totals_per_plugin = [
        PluginTotal(plugin_id=pid, count=c)
        for pid, c in sorted(per_plugin.items(), key=lambda kv: kv[1], reverse=True)
    ]
    return AggregationResult(
        window_hours=window_hours,
        groups=groups,
        total_reports=sum(g.count for g in groups),
        totals_per_plugin=totals_per_plugin,
    )


async def count_reports_for_group(
    db: AsyncSession,
    plugin_id: str,
    version: str,
    step: str,
    window_hours: int,
) -> int:
    """Count reports for a specific (plugin_id, version, step) within the window."""
    cutoff = datetime.now(UTC) - timedelta(hours=window_hours)
    result = await db.execute(
        select(func.count(Report.id)).where(
            Report.plugin_id == plugin_id,
            Report.version == version,
            Report.step == step,
            Report.created_at >= cutoff,
        )
    )
    return int(result.scalar_one())
