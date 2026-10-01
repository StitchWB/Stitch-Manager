"""Utility commands — browser open, debug migration, provider connection test."""

from __future__ import annotations

import webbrowser
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

from stitch_backend.core.command_decorator import command
from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session

if TYPE_CHECKING:
    from sqlalchemy import CursorResult
    from sqlalchemy.ext.asyncio import AsyncSession


@register_command("open_url_in_browser")
async def cmd_open_url_in_browser(params: dict) -> None:
    url = params.get("url", "")
    if url:
        webbrowser.open(url)


@command("debug_run_ai_proxy_migration", admin_only=True)
async def cmd_debug_run_ai_proxy_migration(db: AsyncSession, params: dict) -> str:
    """Run a raw SQL migration for debugging (requires STITCH_DEBUG_ALLOW_SQL=1)."""
    import os

    from sqlalchemy import text as sql_text
    if not os.environ.get("STITCH_DEBUG_ALLOW_SQL"):
        return "Debug SQL execution is disabled. Set STITCH_DEBUG_ALLOW_SQL=1 to enable."
    sql = params.get("sql", "")
    if not sql:
        return "sql is required"

    result = await db.execute(sql_text(sql))
    return f"Rows affected: {cast('CursorResult[Any]', result).rowcount}"


@register_command("test_provider_connection")
async def cmd_test_provider_connection(params: dict) -> dict:
    """Test connection to an AI proxy provider."""
    provider = params.get("provider", "")
    if provider == "zai":
        from stitch_backend.domains.ai_proxy.service import get_zai_token_db_path

        async def _op(session):
            return await get_zai_token_db_path(session)

        token_db_path = await run_in_session(_op)
        if not token_db_path:
            return {
                "success": False,
                "provider": provider,
                "message": "zai_token_db_path is not configured",
                "latencyMs": 0,
            }
        if not Path(token_db_path).is_file():
            return {
                "success": False,
                "provider": provider,
                "message": "zai_token_db_path does not point to an existing file",
                "latencyMs": 0,
            }
        return {
            "success": True,
            "provider": provider,
            "message": "Z.AI token database is configured",
            "latencyMs": 0,
        }
    return {
        "success": False,
        "provider": provider,
        "message": f"Connection test for {provider} not yet implemented",
        "latencyMs": 0,
    }
