"""Application log service — SQLite-backed CRUD for ``app_logs`` table.

Ported from Rust ``logging_service.rs``.  Matches the exact JSON shapes
the frontend expects (``LogEntry``, ``LogFilter``, ``LogQueryResult``, ``LogStats``).
"""

from __future__ import annotations

import csv
import io
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.core.event_bus import event_bus
from stitch_backend.domains.logging.models import AppLog

logger = logging.getLogger(__name__)

VALID_LEVELS = {"debug", "info", "success", "warn", "error"}


def _infer_channel(source: str) -> str:
    """Infer channel from source name — mirrors Rust ``infer_channel``."""
    s = source.lower()
    if "toast" in s:
        return "toast"
    if "frontend" in s:
        return "frontend"
    if "proxy" in s or "ai_proxy" in s:
        return "proxy"
    if "rust" in s or "backend" in s:
        return "backend"
    return "app"


def _row_to_dict(row: AppLog) -> dict[str, Any]:
    """Convert ORM row to the camelCase dict the frontend expects."""
    details = None
    if row.details:
        try:
            details = json.loads(row.details)
        except (json.JSONDecodeError, TypeError):
            details = row.details

    context = None
    if row.context_json:
        try:
            context = json.loads(row.context_json)
        except (json.JSONDecodeError, TypeError):
            context = row.context_json

    return {
        "id": row.id,
        "timestamp": row.timestamp,
        "level": row.level,
        "channel": row.channel,
        "source": row.source,
        "message": row.message,
        "details": details,
        "correlationId": row.correlation_id,
        "sessionId": row.session_id,
        "context": context,
    }


class LoggingService:
    """Manages application logs persisted in ``app_logs`` table."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Add ──────────────────────────────────────────────────────────────

    async def add_log(
        self,
        level: str,
        source: str,
        message: str,
        *,
        details: Any = None,
        channel: str | None = None,
        correlation_id: str | None = None,
        session_id: str | None = None,
        context: Any = None,
    ) -> dict[str, Any]:
        """Insert a log entry and return it as a dict."""
        now = datetime.now(timezone.utc).isoformat()
        log_id = uuid.uuid4().hex

        level = level.lower() if level.lower() in VALID_LEVELS else "info"
        ch = channel or _infer_channel(source)

        details_json = json.dumps(details) if details is not None else None
        context_json = json.dumps(context) if context is not None else None

        entry = AppLog(
            id=log_id,
            timestamp=now,
            level=level,
            channel=ch,
            source=source,
            message=message,
            details=details_json,
            correlation_id=correlation_id,
            session_id=session_id,
            context_json=context_json,
            created_at=now,
        )
        self._db.add(entry)
        await self._db.flush()

        result = {
            "id": log_id,
            "timestamp": now,
            "level": level,
            "channel": ch,
            "source": source,
            "message": message,
            "details": details,
            "correlationId": correlation_id,
            "sessionId": session_id,
            "context": context,
        }

        # Broadcast to frontend via WebSocket
        event_bus.emit_sync("logs.new", result)

        return result

    # ── Query ────────────────────────────────────────────────────────────

    async def query_logs(self, filter_: dict[str, Any] | None = None) -> dict[str, Any]:
        """Query logs with optional filtering.  Returns ``LogQueryResult``."""
        f = filter_ or {}
        levels: list[str] = f.get("levels", [])
        sources: list[str] = f.get("sources", [])
        channels: list[str] = f.get("channels", [])
        search: str | None = f.get("search")
        from_time: str | None = f.get("fromTime")
        to_time: str | None = f.get("toTime")
        limit: int = int(f.get("limit", 100))
        offset: int = int(f.get("offset", 0))

        stmt = select(AppLog)

        if levels:
            stmt = stmt.where(AppLog.level.in_(levels))
        if sources:
            stmt = stmt.where(AppLog.source.in_(sources))
        if channels:
            stmt = stmt.where(AppLog.channel.in_(channels))
        if search:
            stmt = stmt.where(AppLog.message.ilike(f"%{search}%"))
        if from_time:
            stmt = stmt.where(AppLog.timestamp >= from_time)
        if to_time:
            stmt = stmt.where(AppLog.timestamp <= to_time)

        # Count before limit/offset
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await self._db.execute(count_stmt)).scalar_one()

        # Apply ordering + pagination
        stmt = stmt.order_by(AppLog.timestamp.desc()).offset(offset).limit(limit)
        result = await self._db.execute(stmt)
        rows = result.scalars().all()

        logs = [_row_to_dict(r) for r in rows]
        return {
            "logs": logs,
            "total": total,
            "hasMore": (offset + limit) < total,
        }

    # ── Clear ────────────────────────────────────────────────────────────

    async def clear_logs(self, before_date: str | None = None) -> int:
        """Delete logs, optionally only those before a given date."""
        if before_date:
            stmt = delete(AppLog).where(AppLog.timestamp < before_date)
        else:
            stmt = delete(AppLog)
        result = await self._db.execute(stmt)
        await self._db.flush()
        deleted = result.rowcount
        event_bus.emit_sync("logs.cleared", {"count": deleted})
        return deleted

    # ── Export ────────────────────────────────────────────────────────────

    async def export_logs(
        self, filter_: dict[str, Any] | None = None, fmt: str = "json"
    ) -> str:
        """Export filtered logs as JSON, CSV, or plain text."""
        qr = await self.query_logs({**(filter_ or {}), "limit": 100_000, "offset": 0})
        logs = qr["logs"]

        if fmt == "csv":
            buf = io.StringIO()
            if logs:
                writer = csv.DictWriter(buf, fieldnames=logs[0].keys())
                writer.writeheader()
                writer.writerows(logs)
            return buf.getvalue()

        if fmt in ("txt", "text"):
            lines = []
            for entry in logs:
                lines.append(
                    f"[{entry['timestamp']}] [{entry['level'].upper()}] "
                    f"{entry['source']}: {entry['message']}"
                )
            return "\n".join(lines)

        # Default: JSON
        return json.dumps(logs, indent=2, default=str)

    # ── Stats ────────────────────────────────────────────────────────────

    async def get_stats(self) -> dict[str, Any]:
        """Return aggregate log statistics."""
        total = (await self._db.execute(select(func.count(AppLog.id)))).scalar_one()

        by_level: dict[str, int] = {}
        result = await self._db.execute(
            select(AppLog.level, func.count(AppLog.id)).group_by(AppLog.level)
        )
        for level, count in result.all():
            by_level[level] = count

        by_source: dict[str, int] = {}
        result = await self._db.execute(
            select(AppLog.source, func.count(AppLog.id)).group_by(AppLog.source)
        )
        for source, count in result.all():
            by_source[source] = count

        by_channel: dict[str, int] = {}
        result = await self._db.execute(
            select(AppLog.channel, func.count(AppLog.id)).group_by(AppLog.channel)
        )
        for channel, count in result.all():
            by_channel[channel] = count

        return {
            "total": total,
            "byLevel": by_level,
            "bySource": by_source,
            "byChannel": by_channel,
        }
