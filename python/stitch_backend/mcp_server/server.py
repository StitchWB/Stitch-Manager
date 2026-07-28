"""Stitch Manager MCP Server — stdio transport via FastMCP.

Exposes ~64 core commands as typed MCP tools plus meta tools (list_commands, execute_any).
Write commands route through the safety layer (kill-switch, dry-run, journal).

Start::

    python -m stitch_backend.mcp_server
    stitch-mcp
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastmcp import FastMCP

from stitch_backend.bootstrap import bootstrap
from stitch_backend.core.command_registry import list_commands
from stitch_backend.core.invoke import (
    WRITE_COMMANDS,
    invoke_command_safe,
)
from stitch_backend.domains.mcp_bridge.service import ensure_write_allowed
from stitch_backend.mcp_server.tools import register_all_tools

logger = logging.getLogger(__name__)

# ── MCP app ────────────────────────────────────────────────────────────────────

mcp = FastMCP("Stitch Manager")

# ── Core tools ─────────────────────────────────────────────────────────────────
# Commands always exposed as MCP tools.

CORE_TOOLS = [
    # Accounts (15)
    "list_accounts",
    "get_accounts",
    "add_account",
    "delete_account",
    "update_account_token",
    "refresh_account",
    "get_account_quota",
    "validate_account",
    "archive_account",
    "bulk_export_accounts",
    "import_accounts_payload",
    "set_active_account",
    "get_active_accounts",
    "update_account_notes_tags",
    "set_account_proxy",
    # Registration (10)
    "start_registration",
    "get_registration_progress",
    "cancel_registration",
    "auto_register",
    "start_python_autoreg_job",
    "get_registration_jobs",
    "get_registration_status",
    "get_providers",
    "test_imap_connection",
    "get_next_counter",
    # Scenarios (8)
    "list_recorded_scenarios",
    "upsert_recorded_scenario",
    "delete_recorded_scenario",
    "replay_preflight",
    "list_scenario_runs",
    "duplicate_recorded_scenario",
    "set_recorded_scenario_favorite",
    "reindex_recorded_scenarios",
    # Flows (5)
    "list_composed_flows",
    "upsert_composed_flow",
    "delete_composed_flow",
    "start_composed_flow_job",
    "mark_composed_flow_ran",
    # Proxy (8)
    "start_ai_proxy",
    "stop_ai_proxy",
    "get_proxy_status",
    "get_proxy_settings",
    "update_proxy_settings",
    "get_ai_proxy_accounts",
    "create_ai_proxy_account",
    "test_provider_connection",
    # FreeModel (3)
    "start_freemodel_bridge",
    "stop_freemodel_bridge",
    "get_freemodel_bridge_status",
    # Replenishment (3)
    "get_replenishment_status",
    "start_replenishment",
    "stop_replenishment",
    # AWS (3)
    "get_aws_accounts",
    "create_aws_account",
    "get_aws_accounts_stats",
    # Omniroute (4)
    "start_omniroute",
    "stop_omniroute",
    "get_omniroute_status",
    "get_usage_stats",
    # Settings (2)
    "get_settings",
    "update_settings",
]

# ── Tool registration ──────────────────────────────────────────────────────────
# Typed tools are registered by mcp_server/tools.py from command metadata.
# This happens in main() after bootstrap().


# ── Meta tools ─────────────────────────────────────────────────────────────────


@mcp.tool
async def list_mcp_commands(filter: str = "") -> list[str]:  # type: ignore[reportUnusedParameter]
    """List all registered backend commands. Filter by substring."""
    cmds = list_commands()
    if filter:
        cmds = [c for c in cmds if filter.lower() in c.lower()]
    return cmds


@mcp.tool
async def execute_any(command_name: str, args: dict = None) -> Any:  # type: ignore[reportUnusedParameter]
    """Invoke any registered backend command by name (escape hatch)."""
    if command_name in WRITE_COMMANDS:
        ensure_write_allowed(command_name)
    result = await invoke_command_safe(command_name, args or {})
    if not result["ok"]:
        raise Exception(result["error"]["message"])
    return result["data"]


@mcp.tool
async def get_backend_health() -> dict:
    """Return backend health status."""
    return {
        "status": "ok",
        "commandsRegistered": len(list_commands()),
        "mcpTools": len(CORE_TOOLS),
    }


# ── Entry point ────────────────────────────────────────────────────────────────


def main() -> None:
    """Run the MCP server on stdio."""
    asyncio.run(bootstrap())
    register_all_tools(mcp, core_only=True)
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()