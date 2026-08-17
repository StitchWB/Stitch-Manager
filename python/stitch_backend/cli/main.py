"""Stitch CLI — typer app with grouped commands and named flags.

Usage::

    stitch list-commands [--filter TEXT]
    stitch run <command_name> [--args JSON]
    stitch <category> <command> [OPTIONS]
    stitch create-admin [--username X]

Examples::

    stitch accounts list
    stitch accounts add --provider kiro --email test@test.com
    stitch registration start --provider kiro
    stitch proxy start
    stitch create-admin --username admin

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


@app.command("create-admin")
def cmd_create_admin(
    username: str = typer.Option("admin", "--username", help="Username for the new admin"),
    password: str = typer.Option(
        None,
        "--password",
        help="Password (prefer STITCH_ADMIN_PASSWORD env var or prompt)",
        show_default=False,
    ),
) -> None:
    """Create an admin user for app-level auth.

    Reads the password from (in order): ``--password`` flag, the
    ``STITCH_ADMIN_PASSWORD`` env var, or an interactive ``getpass`` prompt.
    The password is never logged.  Exits 1 on failure (duplicate username,
    empty password, etc.).
    """
    import os

    from stitch_backend.config import get_settings
    from stitch_backend.database import get_session_factory
    from stitch_backend.domains.auth.service import create_user

    settings = get_settings()
    resolved_password = password or settings.admin_password or os.environ.get("STITCH_ADMIN_PASSWORD")
    if not resolved_password:
        import getpass

        resolved_password = getpass.getpass(f"Password for {username!r}: ")
    if not resolved_password:
        print(json.dumps({"error": "Password must not be empty"}), file=sys.stderr)
        raise typer.Exit(1)

    async def _create() -> None:
        factory = get_session_factory()
        async with factory() as db:
            user = await create_user(db, username=username, password=resolved_password, role="admin")
            await db.commit()
            print(json.dumps({"id": user.id, "username": user.username, "role": user.role}))

    try:
        asyncio.run(_create())
    except Exception as exc:  # noqa: BLE001 — surface any error to the operator
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        raise typer.Exit(1) from None


if __name__ == "__main__":
    app()
