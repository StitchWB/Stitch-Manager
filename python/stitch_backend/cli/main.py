"""Stitch CLI — typer app with grouped commands and named flags.

Usage::

    stitch list-commands [--filter TEXT]
    stitch run <command_name> [--args JSON]
    stitch <category> <command> [OPTIONS]

Examples::

    stitch accounts list
    stitch accounts add --provider kiro --email test@test.com
    stitch registration start --provider kiro
    stitch proxy start

All output is JSON to stdout.
"""

from __future__ import annotations

import asyncio
import json
import sys

import typer

from stitch_backend.bootstrap import bootstrap
from stitch_backend.cli.groups import register_all_commands
from stitch_backend.core.command_registry import (
    list_commands,
)
from stitch_backend.core.invoke import invoke_command_safe, serialise

app = typer.Typer(no_args_is_help=True)


def _ensure_bootstrapped() -> None:
    """Run bootstrap once (idempotent)."""
    if not _bootstrapped[0]:
        asyncio.run(bootstrap())
        _bootstrapped[0] = True


_bootstrapped: list[bool] = [False]

# Bootstrap immediately so --help shows grouped commands.
# This slows startup but ensures command metadata is available.
_ensure_bootstrapped()

# Register grouped commands with named flags
register_all_commands(app, _ensure_bootstrapped)


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
    """Invoke any registered backend command by name (escape hatch)."""
    _ensure_bootstrapped()
    try:
        parsed = json.loads(args) if args else {}
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON args: {e}"}), file=sys.stderr)
        raise typer.Exit(2) from None

    result = asyncio.run(invoke_command_safe(command_name, parsed))
    if not result["ok"]:
        print(json.dumps(result["error"], indent=2), file=sys.stderr)
        raise typer.Exit(result["error"]["code"])

    print(json.dumps(serialise(result["data"]), indent=2, default=str))


if __name__ == "__main__":
    app()
