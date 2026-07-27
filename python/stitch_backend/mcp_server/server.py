"""Stitch Manager MCP Server — stdio transport via FastMCP.

Exposes ~64 core commands as MCP tools plus meta tools (list_commands, execute_any).
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
from stitch_backend.core.command_registry import (
    get_command_handler,
    list_commands,
)
from stitch_backend.domains.mcp_bridge.service import (
    append_critical_journal,
    dry_run_enabled,
    ensure_write_allowed,
)

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

# Commands that mutate state — must pass safety checks.
WRITE_COMMANDS: set[str] = {
    "add_account",
    "delete_account",
    "update_account_token",
    "refresh_account",
    "archive_account",
    "import_accounts_payload",
    "set_active_account",
    "update_account_notes_tags",
    "set_account_proxy",
    "start_registration",
    "cancel_registration",
    "auto_register",
    "start_python_autoreg_job",
    "upsert_recorded_scenario",
    "delete_recorded_scenario",
    "duplicate_recorded_scenario",
    "set_recorded_scenario_favorite",
    "reindex_recorded_scenarios",
    "upsert_composed_flow",
    "delete_composed_flow",
    "start_composed_flow_job",
    "mark_composed_flow_ran",
    "start_ai_proxy",
    "stop_ai_proxy",
    "update_proxy_settings",
    "create_ai_proxy_account",
    "start_freemodel_bridge",
    "stop_freemodel_bridge",
    "start_replenishment",
    "stop_replenishment",
    "create_aws_account",
    "start_omniroute",
    "stop_omniroute",
    "update_settings",
}


def _serialise(value: Any) -> Any:
    """Coerce handler return value into JSON-safe data."""
    if value is None:
        return {}
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True)
    if isinstance(value, list) and value and hasattr(value[0], "model_dump"):
        return [v.model_dump(mode="json", by_alias=True) for v in value]
    return value


async def _invoke_command(name: str, args: dict) -> Any:
    """Invoke a command handler by name, with safety guards for writes."""
    if name in WRITE_COMMANDS:
        ensure_write_allowed(name)

    handler = get_command_handler(name)

    if dry_run_enabled():
        result = {"dryRun": True, "command": name, "args": args}
        append_critical_journal(name, args, result)
        return result

    result = await handler(args)
    result = _serialise(result)

    if name in WRITE_COMMANDS:
        append_critical_journal(name, args, result)

    return result


# ── Tool factory ───────────────────────────────────────────────────────────────
# Dynamically register each core command as an MCP tool.

def _make_tool(name: str):
    """Create a tool function for a given command name."""

    async def tool_fn(args: dict = None) -> Any:  # type: ignore[reportUnusedParameter]
        return await _invoke_command(name, args or {})

    tool_fn.__name__ = name
    tool_fn.__doc__ = f"Invoke the '{name}' backend command."
    return tool_fn


# Register all core tools — command existence is checked lazily at runtime
# (after bootstrap() imports all command modules).
for _cmd_name in CORE_TOOLS:
    fn = _make_tool(_cmd_name)
    mcp.tool(fn)


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
    return await _invoke_command(command_name, args or {})


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
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()