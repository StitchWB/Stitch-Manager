"""Shared command invocation logic for MCP server and CLI.

Centralizes:
- WRITE_COMMANDS set (commands that mutate state)
- serialise() function (convert handler results to JSON-safe data)
- invoke_command() with safety guards (kill-switch, dry-run, journal)
- invoke_command_safe() wrapper that returns structured results
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import ValidationError

from stitch_backend.core.command_registry import (
    CommandNotFoundError as RegistryCommandNotFoundError,
)
from stitch_backend.core.command_registry import (
    get_command_handler,
)
from stitch_backend.core.errors import (
    CommandNotFoundError,
    ErrorCode,
    StitchError,
    WriteBlockedError,
)
from stitch_backend.domains.mcp_bridge.service import (
    append_critical_journal,
    dry_run_enabled,
    ensure_write_allowed,
)

logger = logging.getLogger(__name__)

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
    "update_proxy_settings",
    "create_ai_proxy_account",
    "start_freemodel_bridge",
    "stop_freemodel_bridge",
    "start_replenishment",
    "stop_replenishment",
    "create_aws_account",
    "update_settings",
}


def serialise(value: Any) -> Any:
    """Coerce handler return value into JSON-safe data.

    Handles:
    - None → {}
    - Pydantic models → dict (with by_alias=True for camelCase)
    - Lists of Pydantic models → list of dicts
    - Primitives → pass through
    """
    if value is None:
        return {}
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True)
    if isinstance(value, list) and value and hasattr(value[0], "model_dump"):
        return [v.model_dump(mode="json", by_alias=True) for v in value]
    return value


async def invoke_command(name: str, args: dict) -> Any:
    """Invoke a command handler by name, with safety guards for writes.

    Raises:
        CommandNotFoundError: If command is not registered
        WriteBlockedError: If write command is blocked by safety guards
        ValidationError: If Pydantic validation fails
        Exception: Any other error from handler execution
    """
    # Check command exists (raises RegistryCommandNotFoundError if not)
    try:
        handler = get_command_handler(name)
    except RegistryCommandNotFoundError:
        raise CommandNotFoundError(name) from None

    # Safety guards for write commands
    if name in WRITE_COMMANDS:
        try:
            ensure_write_allowed(name)
        except Exception as e:
            raise WriteBlockedError(name, str(e)) from None

    # Dry-run mode: return preview without executing
    if dry_run_enabled():
        result = {"dryRun": True, "command": name, "args": args}
        append_critical_journal(name, args, result)
        return result

    # Execute handler
    result = await handler(args)
    result = serialise(result)

    # Journal write commands
    if name in WRITE_COMMANDS:
        append_critical_journal(name, args, result)

    return result


async def invoke_command_safe(name: str, args: dict) -> dict[str, Any]:
    """Invoke a command and return structured result (ok/error).

    Returns:
        {"ok": True, "data": ...} on success
        {"ok": False, "error": {"code": ..., "message": ..., "details": ...}} on failure
    """
    try:
        result = await invoke_command(name, args)
        return {"ok": True, "data": result}

    except StitchError as e:
        # Already structured (CommandNotFoundError, WriteBlockedError)
        return {"ok": False, "error": e.to_dict()}

    except ValidationError as e:
        # Pydantic validation errors → structured details
        return {
            "ok": False,
            "error": {
                "code": ErrorCode.VALIDATION.value,
                "message": "Invalid arguments",
                "details": e.errors(),
            },
        }

    except Exception as e:
        # Unexpected errors
        logger.exception(f"Unexpected error in command '{name}'")
        return {
            "ok": False,
            "error": {
                "code": ErrorCode.INTERNAL.value,
                "message": str(e),
                "details": {},
            },
        }
