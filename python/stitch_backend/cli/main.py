"""Stitch CLI — typer app with dynamic commands for all registered backend handlers.

Usage::

    stitch list-commands [--filter TEXT]
    stitch run <command_name> [--args JSON]
    stitch <core_command> [--args JSON]

All output is JSON to stdout.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import typer

from stitch_backend.bootstrap import bootstrap
from stitch_backend.core.command_registry import (
    CommandNotFoundError,
    get_command_handler,
    list_commands,
)

app = typer.Typer(no_args_is_help=True)

# ── Core tools (same list as MCP server) ───────────────────────────────────────

CORE_TOOLS = [
    "list_accounts", "get_accounts", "add_account", "delete_account",
    "update_account_token", "refresh_account", "get_account_quota",
    "validate_account", "archive_account", "bulk_export_accounts",
    "import_accounts_payload", "set_active_account", "get_active_accounts",
    "update_account_notes_tags", "set_account_proxy",
    "start_registration", "get_registration_progress", "cancel_registration",
    "auto_register", "start_python_autoreg_job", "get_registration_jobs",
    "get_registration_status", "get_providers", "test_imap_connection",
    "get_next_counter",
    "list_recorded_scenarios", "upsert_recorded_scenario",
    "delete_recorded_scenario", "replay_preflight", "list_scenario_runs",
    "duplicate_recorded_scenario", "set_recorded_scenario_favorite",
    "reindex_recorded_scenarios",
    "list_composed_flows", "upsert_composed_flow", "delete_composed_flow",
    "start_composed_flow_job", "mark_composed_flow_ran",
    "start_ai_proxy", "stop_ai_proxy", "get_proxy_status",
    "get_proxy_settings", "update_proxy_settings", "get_ai_proxy_accounts",
    "create_ai_proxy_account", "test_provider_connection",
    "start_freemodel_bridge", "stop_freemodel_bridge",
    "get_freemodel_bridge_status",
    "get_replenishment_status", "start_replenishment", "stop_replenishment",
    "get_aws_accounts", "create_aws_account", "get_aws_accounts_stats",
    "start_omniroute", "stop_omniroute", "get_omniroute_status",
    "get_usage_stats",
    "get_settings", "update_settings",
]


def _serialise(value: Any) -> Any:
    """Coerce handler return value into JSON-safe data."""
    if value is None:
        return {}
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True)
    if isinstance(value, list) and value and hasattr(value[0], "model_dump"):
        return [v.model_dump(mode="json", by_alias=True) for v in value]
    return value


def _ensure_bootstrapped() -> None:
    """Run bootstrap once (idempotent)."""
    if not _bootstrapped[0]:
        asyncio.run(bootstrap())
        _bootstrapped[0] = True


_bootstrapped: list[bool] = [False]


# ── Built-in commands ──────────────────────────────────────────────────────────


@app.command("list-commands")
def cmd_list_commands(filter: str = typer.Option("", "--filter", "-f", help="Filter by substring")) -> None:
    """List all registered backend commands."""
    _ensure_bootstrapped()
    cmds = list_commands()
    if filter:
        cmds = [c for c in cmds if filter.lower() in c.lower()]
    print(json.dumps(cmds, indent=2))


@app.command("run")
def cmd_run(
    command_name: str = typer.Argument(..., help="Command name to invoke"),
    args: str = typer.Option("{}", "--args", "-a", help="JSON arguments dict"),
) -> None:
    """Invoke any registered backend command by name."""
    _ensure_bootstrapped()
    try:
        parsed = json.loads(args) if args else {}
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON args: {e}"}))
        raise typer.Exit(1) from None

    try:
        handler = get_command_handler(command_name)
    except CommandNotFoundError:
        print(json.dumps({"error": f"Unknown command: '{command_name}'"}))
        raise typer.Exit(1) from None

    try:
        result = _serialise(asyncio.run(handler(parsed)))
        print(json.dumps(result, indent=2, default=str))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        raise typer.Exit(1) from None


# ── Dynamic core commands ──────────────────────────────────────────────────────
# Register each core tool as a typer command.

def _make_cmd(name: str):
    """Create a typer command function for a core tool."""

    def cmd(
        args: str = typer.Option("{}", "--args", "-a", help="JSON arguments dict"),
    ) -> None:
        _ensure_bootstrapped()
        try:
            parsed = json.loads(args) if args else {}
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"Invalid JSON args: {e}"}))
            raise typer.Exit(1) from None

        try:
            handler = get_command_handler(name)
            result = _serialise(asyncio.run(handler(parsed)))
            print(json.dumps(result, indent=2, default=str))
        except CommandNotFoundError:
            print(json.dumps({"error": f"Unknown command: '{name}'"}))
            raise typer.Exit(1) from None
        except Exception as exc:
            print(json.dumps({"error": str(exc)}))
            raise typer.Exit(1) from None

    cmd.__name__ = name
    return cmd


for _cmd_name in CORE_TOOLS:
    app.command(name=_cmd_name, help=f"Invoke the '{_cmd_name}' backend command.")(
        _make_cmd(_cmd_name)
    )


if __name__ == "__main__":
    app()