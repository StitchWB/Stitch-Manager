"""Logging commands — replaces stubs in ``utility/stubs.py``.

Frontend calls these via ``safeInvoke('get_logs', …)``, etc.
Response shapes match ``LogEntry``, ``LogQueryResult``, ``LogStats``
defined in legacy frontend logging module.
"""

from __future__ import annotations

from typing import Any, cast

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session

# ── Query operations ─────────────────────────────────────────────────────────

@register_command("get_logs", readonly=True)
async def cmd_get_logs(params: dict) -> dict:
    """Get logs with optional filtering.

    Params: ``filter`` (LogFilter dict)
    Returns: ``LogQueryResult`` {logs, total, hasMore}
    """
    from stitch_backend.domains.logging.service import LoggingService

    filter_ = params.get("filter")
    return await run_in_read_session(
        lambda s: LoggingService(s).query_logs(filter_)
    )


@register_command("get_log_stats", readonly=True)
async def cmd_get_log_stats(params: dict) -> dict:
    """Get log statistics.

    Returns: ``LogStats`` {total, byLevel, bySource, byChannel}
    """
    from stitch_backend.domains.logging.service import LoggingService

    return await run_in_read_session(
        lambda s: LoggingService(s).get_stats()
    )


# ── Add operations ───────────────────────────────────────────────────────────

@register_command("add_log")
async def cmd_add_log(params: dict) -> dict:
    """Add a log entry from frontend.

    Params: level, source, message, details?, channel?, correlationId?,
            sessionId?, context?
    Returns: ``LogEntry``
    """
    from stitch_backend.domains.logging.service import LoggingService

    return await run_in_session(
        lambda s: LoggingService(s).add_log(
            level=params.get("level", "info"),
            source=params.get("source", "frontend"),
            message=params.get("message", ""),
            details=params.get("details"),
            channel=params.get("channel"),
            correlation_id=params.get("correlationId"),
            session_id=params.get("sessionId"),
            context=params.get("context"),
        )
    )


@register_command("add_app_log")
async def cmd_add_app_log(params: dict) -> dict:
    """Compatibility alias for ``add_log``."""
    return cast("dict[Any, Any]", await cmd_add_log(params))


# ── Clear operations ─────────────────────────────────────────────────────────

@register_command("clear_logs")
async def cmd_clear_logs(params: dict) -> int:
    """Clear logs, optionally before a specific date.

    Params: ``beforeDate`` (ISO 8601 string, optional)
    Returns: number of deleted rows
    """
    from stitch_backend.domains.logging.service import LoggingService

    before_date = params.get("beforeDate")
    return await run_in_session(
        lambda s: LoggingService(s).clear_logs(before_date)
    )


@register_command("clear_app_logs")
async def cmd_clear_app_logs(params: dict) -> int:
    """Compatibility alias for ``clear_logs``."""
    return cast("int", await cmd_clear_logs(params))


# ── Export operations ────────────────────────────────────────────────────────

@register_command("export_logs", readonly=True)
async def cmd_export_logs(params: dict) -> str:
    """Export logs to string (JSON, CSV, or TXT format).

    Params: ``filter`` (LogFilter dict), ``format`` ('json'|'csv'|'txt')
    Returns: formatted string
    """
    from stitch_backend.domains.logging.service import LoggingService

    filter_ = params.get("filter")
    fmt = params.get("format", "json")
    return await run_in_read_session(
        lambda s: LoggingService(s).export_logs(filter_, fmt)
    )


@register_command("export_app_logs", readonly=True)
async def cmd_export_app_logs(params: dict) -> str:
    """Compatibility alias for ``export_logs``."""
    return cast("str", await cmd_export_logs(params))
