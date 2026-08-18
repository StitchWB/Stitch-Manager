"""GET /admin/drift — v1.1 selector drift aggregation (plan §3.4.11, §8).

Reads stored report bundles from disk and aggregates per
(plugin_id, version, step): fail_count, last_failure_at, top_errors[3],
matched_candidate_histogram. Tolerates missing/corrupt bundle files
(skipped + counted). Window defaults to 7*24=168 hours.

Success events are NOT recorded server-side today — this view is
failures-only. When the engine starts reporting success bundles (future
v1.1 work), ``success_hints`` will carry per-candidate match counts;
until then it is an empty dict and the response note documents the gap.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002 — FastAPI resolves at runtime

from stitch_server.auth import require_admin
from stitch_server.db import get_db
from stitch_server.models import Report

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])

DEFAULT_WINDOW_HOURS = 168  # 7 days
TOP_ERRORS_LIMIT = 3


# ── Response models ────────────────────────────────────────────────────────────


class DriftGroup(BaseModel):
    """Aggregated drift for one (plugin_id, version, step) group."""

    plugin_id: str
    version: str
    step: str
    fail_count: int
    last_failure_at: datetime | None
    top_errors: list[dict[str, Any]]  # [{error: str, count: int}]
    matched_candidate_histogram: dict[str, int]  # {"0": 2, "null": 3}
    scrubbed_count: int
    corrupt_bundle_count: int


class DriftResult(BaseModel):
    """Full drift response."""

    window_hours: int
    plugin_filter: str | None
    version_filter: str | None
    groups: list[DriftGroup]
    total_reports: int
    corrupt_bundles_skipped: int
    success_hints: dict[str, Any]  # empty until success events ship
    note: str


# ── Endpoint ───────────────────────────────────────────────────────────────────


@router.get("/drift", response_model=DriftResult)
async def drift(
    db: Annotated[AsyncSession, Depends(get_db)],
    plugin_id: Annotated[str | None, Query()] = None,
    version: Annotated[str | None, Query()] = None,
    window_hours: Annotated[int | None, Query(ge=1)] = None,
) -> DriftResult:
    """Aggregate failure reports by (plugin, version, step) with
    matched_candidate stats.

    Reads bundle JSON from disk (bundle_path) to extract step_kind,
    matched_candidate, error, scrubbed. Missing/corrupt files are
    skipped and counted in ``corrupt_bundles_skipped``.
    """
    hours = window_hours if window_hours is not None else DEFAULT_WINDOW_HOURS
    cutoff = datetime.now(UTC) - timedelta(hours=hours)

    stmt = (
        select(Report)
        .where(Report.created_at >= cutoff)
        .order_by(Report.created_at.desc())
    )
    if plugin_id is not None:
        stmt = stmt.where(Report.plugin_id == plugin_id)
    if version is not None:
        stmt = stmt.where(Report.version == version)

    rows = (await db.execute(stmt)).scalars().all()

    # Aggregate per (plugin, version, step)
    groups: dict[tuple[str, str, str], dict[str, Any]] = {}
    total_reports = 0
    corrupt_skipped = 0

    for report in rows:
        total_reports += 1
        key = (report.plugin_id, report.version, report.step)
        g = groups.setdefault(
            key,
            {
                "plugin_id": report.plugin_id,
                "version": report.version,
                "step": report.step,
                "fail_count": 0,
                "last_failure_at": None,
                "errors": Counter(),
                "matched_candidate": Counter(),
                "scrubbed_count": 0,
                "corrupt_bundle_count": 0,
            },
        )
        g["fail_count"] += 1
        g["last_failure_at"] = report.created_at  # rows are desc-ordered

        bundle = _read_bundle(report.bundle_path)
        if bundle is None:
            g["corrupt_bundle_count"] += 1
            corrupt_skipped += 1
            continue

        if bundle.get("scrubbed"):
            g["scrubbed_count"] += 1

        mc = bundle.get("matched_candidate")
        mc_key = "null" if mc is None else str(mc)
        g["matched_candidate"][mc_key] += 1

        error = bundle.get("error") or ""
        if error:
            g["errors"][error] += 1

    group_list = [
        DriftGroup(
            plugin_id=g["plugin_id"],
            version=g["version"],
            step=g["step"],
            fail_count=g["fail_count"],
            last_failure_at=g["last_failure_at"],
            top_errors=[
                {"error": err, "count": cnt}
                for err, cnt in g["errors"].most_common(TOP_ERRORS_LIMIT)
            ],
            matched_candidate_histogram=dict(g["matched_candidate"]),
            scrubbed_count=g["scrubbed_count"],
            corrupt_bundle_count=g["corrupt_bundle_count"],
        )
        for g in groups.values()
    ]
    group_list.sort(key=lambda x: x.fail_count, reverse=True)

    return DriftResult(
        window_hours=hours,
        plugin_filter=plugin_id,
        version_filter=version,
        groups=group_list,
        total_reports=total_reports,
        corrupt_bundles_skipped=corrupt_skipped,
        success_hints={},
        note=(
            "Failures-only view. Success events are not recorded server-side "
            "today; matched_candidate_histogram reflects the last-tried "
            "candidate index from failure bundles (null = no candidate matched)."
        ),
    )


# ── Bundle reader ──────────────────────────────────────────────────────────────


def _read_bundle(bundle_path: str) -> dict[str, Any] | None:
    """Read and parse a bundle JSON file. Returns None if missing/corrupt."""
    p = Path(bundle_path)
    if not p.is_file():
        logger.debug("drift: bundle missing: %s", bundle_path)
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.debug("drift: bundle corrupt: %s — %s", bundle_path, exc)
        return None
    if not isinstance(data, dict):
        logger.debug("drift: bundle not a dict: %s", bundle_path)
        return None
    return data
