"""Stitch Manager MCP Server — stdio transport via FastMCP.

Exposes core commands as typed MCP tools plus meta tools (list_mcp_commands,
execute_any, get_backend_health, get_safety_status, read_critical_journal,
get_mcp_doctor).  Write commands route through the safety layer
(kill-switch, dry-run, journal).

Start::

    python -m stitch_backend.mcp_server
    stitch-mcp
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastmcp import FastMCP

from stitch_backend.bootstrap import bootstrap
from stitch_backend.core.command_registry import list_commands
from stitch_backend.core.invoke import WRITE_COMMANDS
from stitch_backend.domains.mcp_bridge.service import ensure_write_allowed
from stitch_backend.mcp_server.tools import (
    _as_structured,
    _invoke_with_policy,
    _mcp_caller,
    register_all_tools,
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
    # Proxy (5)
    "get_proxy_settings",
    "update_proxy_settings",
    "get_ai_proxy_accounts",
    "create_ai_proxy_account",
    "test_provider_connection",
    # Turnstile solver (3)
    "start_turnstile_solver",
    "stop_turnstile_solver",
    "get_turnstile_solver_status",
    # Replenishment (3)
    "get_replenishment_status",
    "start_replenishment",
    "stop_replenishment",
    # AWS (3)
    "get_aws_accounts",
    "create_aws_account",
    "get_aws_accounts_stats",
    # MCP bridge (1)
    "mcp_get_server_info",
    # Settings (2)
    "get_settings",
    "update_settings",
]

# Meta tools registered directly on the FastMCP app (not backed by commands).
_META_TOOLS = (
    "list_mcp_commands",
    "execute_any",
    "get_backend_health",
    "get_safety_status",
    "read_critical_journal",
    "get_mcp_doctor",
)

_registered_core_tool_count = 0

# ── Tool registration ──────────────────────────────────────────────────────────
# Typed tools are registered by mcp_server/tools.py from command metadata.
# This happens in main() after bootstrap().


# ── Meta tools ─────────────────────────────────────────────────────────────────


@mcp.tool
async def list_mcp_commands(filter: str = "") -> list[str]:
    """List all registered backend commands. Filter by substring."""
    cmds = list_commands()
    if filter:
        cmds = [c for c in cmds if filter.lower() in c.lower()]
    return cmds


@mcp.tool
async def execute_any(command_name: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    """Invoke any registered backend command by name (escape hatch)."""
    if command_name in WRITE_COMMANDS:
        ensure_write_allowed(command_name)
    result = await _invoke_with_policy(command_name, {**(args or {}), **_mcp_caller()})
    if not result["ok"]:
        raise Exception(result["error"]["message"])
    return _as_structured(result["data"])


@mcp.tool
async def get_backend_health() -> dict:
    """Return backend health status."""
    return {
        "status": "ok",
        "commandsRegistered": len(list_commands()),
        "coreToolsDeclared": len(CORE_TOOLS),
        "coreToolsRegistered": _registered_core_tool_count,
        "metaTools": len(_META_TOOLS),
        "mcpTools": _registered_core_tool_count + len(_META_TOOLS),
    }


@mcp.tool
async def get_safety_status() -> dict:
    """Return the write-safety guard state (autonomy, dry-run, kill-switch)."""
    from stitch_backend.domains.mcp_bridge.service import (
        account_persist_allowed,
        autonomy_enabled,
        critical_journal_path,
        dry_run_enabled,
        kill_switch_path,
    )

    kill_switch = kill_switch_path()
    return {
        "callerRole": _mcp_caller()["_caller_role"],
        "autonomyEnabled": autonomy_enabled(),
        "dryRun": dry_run_enabled(),
        "allowAccountPersist": account_persist_allowed(),
        "killSwitchPath": str(kill_switch),
        "killSwitchActive": kill_switch.exists(),
        "criticalJournalPath": str(critical_journal_path()),
    }


@mcp.tool
async def read_critical_journal(limit: int = 20) -> list[dict]:
    """Return the most recent entries of the MCP critical-action journal."""
    from stitch_backend.domains.mcp_bridge.service import critical_journal_path

    path = critical_journal_path()
    if not path.exists():
        return []
    bounded = max(1, min(limit, 500))
    entries: list[dict] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines()[-bounded:]:
        stripped = raw_line.strip()
        if not stripped:
            continue
        try:
            entries.append(json.loads(stripped))
        except ValueError:
            continue
    return entries


@mcp.tool
async def get_mcp_doctor() -> dict:
    """Diagnose the MCP surface: tool counts, drift and schema coverage."""
    from stitch_backend.core.command_meta import get_all_command_meta

    registered = set(list_commands())
    missing = sorted(name for name in CORE_TOOLS if name not in registered)
    meta = get_all_command_meta()
    known = [name for name in CORE_TOOLS if name in meta]
    typed = [n for n in known if meta[n].request_model is not None]
    fallback = [n for n in known if meta[n].request_model is None and meta[n].takes_params]
    no_args = [n for n in known if meta[n].request_model is None and not meta[n].takes_params]
    no_meta = [name for name in CORE_TOOLS if name not in meta]

    warnings: list[str] = []
    if missing:
        warnings.append(f"{len(missing)} CORE_TOOLS declared but not registered")
    if _registered_core_tool_count != len(CORE_TOOLS):
        warnings.append(
            f"registered core tools {_registered_core_tool_count} != declared {len(CORE_TOOLS)}"
        )
    if no_meta:
        warnings.append(f"{len(no_meta)} CORE_TOOLS have no metadata")

    return {
        "status": "warn" if warnings else "ok",
        "callerRole": _mcp_caller()["_caller_role"],
        "commandsRegistered": len(registered),
        "coreToolsDeclared": len(CORE_TOOLS),
        "coreToolsRegistered": _registered_core_tool_count,
        "metaTools": len(_META_TOOLS),
        "declaredButUnregistered": missing,
        "toolsWithTypedSchema": len(typed),
        "toolsWithArgsFallback": fallback,
        "toolsNoArgs": len(no_args),
        "toolsMissingMeta": no_meta,
        "warnings": warnings,
    }


# ── Resources & prompts ─────────────────────────────────────────────────────────


@mcp.resource("stitch://safety-status")
async def safety_status_resource() -> str:
    """Write-safety guard state as JSON."""
    return json.dumps(await get_safety_status(), indent=2)


@mcp.resource("stitch://accounts/overview")
async def accounts_overview_resource() -> str:
    """Account counts by provider and status, secrets excluded."""
    result = await _invoke_with_policy(
        "list_accounts", {"limit": 1000, "includeSecrets": False, **_mcp_caller()}
    )
    if not result["ok"]:
        return json.dumps({"error": result["error"]["message"]})
    rows = result["data"] if isinstance(result["data"], list) else []
    by_provider: dict[str, int] = {}
    by_status: dict[str, int] = {}
    for row in rows:
        provider = str(row.get("provider", "unknown"))
        status = str(row.get("status", "unknown"))
        by_provider[provider] = by_provider.get(provider, 0) + 1
        by_status[status] = by_status.get(status, 0) + 1
    return json.dumps(
        {"total": len(rows), "byProvider": by_provider, "byStatus": by_status},
        indent=2,
    )


@mcp.prompt
def account_triage() -> str:
    """Guide an agent through a read-only account health review."""
    return (
        "Review the account inventory without changing anything:\n"
        "1. Call get_mcp_doctor and report any warnings.\n"
        "2. Read the stitch://accounts/overview resource for the provider and\n"
        "   status breakdown.\n"
        "3. Call list_accounts (bounded, secrets omitted) and flag rows that are\n"
        "   not active or look stale; use get_account_quota on the suspicious ids.\n"
        "4. Summarise findings and propose which accounts to refresh and why.\n"
        "Ask for confirmation before running any write command."
    )


# ── Entry point ────────────────────────────────────────────────────────────────


def main() -> None:
    """Run the MCP server on stdio."""
    global _registered_core_tool_count
    asyncio.run(bootstrap(log_to_stderr=True))
    _registered_core_tool_count = register_all_tools(mcp, core_only=True)
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
