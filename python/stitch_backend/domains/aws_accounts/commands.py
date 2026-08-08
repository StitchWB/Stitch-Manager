"""AWS Builder ID account command handlers — 11 commands.

Mirrors Rust ``commands/aws_accounts.rs``.
"""

from __future__ import annotations

from typing import Any, cast

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session


@register_command("get_aws_accounts")
async def cmd_get_aws_accounts(params: dict) -> list:
    """Get all AWS Builder ID accounts, optionally filtered by status."""
    from stitch_backend.domains.aws_accounts.service import AwsAccountsService

    status_filter = params.get("statusFilter", params.get("status_filter"))

    async def _op(session):
        return await AwsAccountsService(session).get_all(status_filter)

    return await run_in_session(_op)


@register_command("get_available_aws_accounts")
async def cmd_get_available_aws_accounts(params: dict) -> list:
    """Get available (status=active) AWS accounts."""
    from stitch_backend.domains.aws_accounts.service import AwsAccountsService

    async def _op(session):
        return await AwsAccountsService(session).get_available()

    return await run_in_session(_op)


@register_command("get_aws_account_by_id")
async def cmd_get_aws_account_by_id(params: dict) -> dict | None:
    """Get a single AWS account by ID."""
    from stitch_backend.domains.aws_accounts.service import AwsAccountsService

    account_id = int(params.get("id", params.get("accountId", 0)))

    async def _op(session):
        return await AwsAccountsService(session).get_by_id(account_id)

    return await run_in_session(_op)


@register_command("create_aws_account")
async def cmd_create_aws_account(params: dict) -> dict:
    """Create a new AWS Builder ID account."""
    from stitch_backend.domains.aws_accounts.service import AwsAccountsService

    async def _op(session):
        return await AwsAccountsService(session).create(params)

    return await run_in_session(_op)


@register_command("update_aws_account_status")
async def cmd_update_aws_account_status(params: dict) -> dict:
    """Update an AWS account's status."""
    from stitch_backend.domains.aws_accounts.service import AwsAccountsService

    account_id = int(params.get("id", 0))
    status = params.get("status", "active")

    async def _op(session):
        await AwsAccountsService(session).update_status(account_id, status)
        return {"success": True}

    return await run_in_session(_op)


@register_command("increment_aws_account_use")
async def cmd_increment_aws_account_use(params: dict) -> dict:
    """Increment an AWS account's use count."""
    from stitch_backend.domains.aws_accounts.service import AwsAccountsService

    account_id = int(params.get("id", 0))

    async def _op(session):
        await AwsAccountsService(session).increment_use_count(account_id)
        return {"success": True}

    return await run_in_session(_op)


@register_command("update_aws_account_browser_profile")
async def cmd_update_aws_account_browser_profile(params: dict) -> dict:
    """Update an AWS account's browser profile path."""
    from stitch_backend.domains.aws_accounts.service import AwsAccountsService

    account_id = int(params.get("id", 0))
    profile_path = params.get("profilePath", params.get("profile_path", ""))

    async def _op(session):
        await AwsAccountsService(session).update_browser_profile(account_id, profile_path)
        return {"success": True}

    return await run_in_session(_op)


@register_command("delete_aws_account")
async def cmd_delete_aws_account(params: dict) -> dict:
    """Delete an AWS Builder ID account."""
    from stitch_backend.domains.aws_accounts.service import AwsAccountsService

    account_id = int(params.get("id", 0))

    async def _op(session):
        await AwsAccountsService(session).delete(account_id)
        return {"success": True}

    return await run_in_session(_op)


@register_command("get_aws_accounts_stats")
async def cmd_get_aws_accounts_stats(params: dict) -> list:
    """Get AWS accounts count grouped by status."""
    from stitch_backend.domains.aws_accounts.service import AwsAccountsService

    async def _op(session):
        return await AwsAccountsService(session).count_by_status()

    return await run_in_session(_op)


@register_command("get_account_bindings")
async def cmd_get_account_bindings(params: dict) -> dict:
    """Get account bindings from kiro-patch config.

    Mirrors Rust ``get_account_bindings`` in kiro_patch.rs.
    Reads from ~/.stitch-manager/kiro-patch-config.json.
    """
    import json
    from pathlib import Path

    config_path = Path.home() / ".stitch-manager" / "kiro-patch-config.json"
    if not config_path.exists():
        return {}
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
        return cast("dict[Any, Any]", data.get("account_bindings", {}))
    except Exception:
        return {}


@register_command("refresh_account_token", readonly=True)
async def cmd_refresh_account_token(params: dict) -> dict:
    """Manually refresh an account's token.

    Mirrors Rust ``refresh_account_token`` — attempts OAuth refresh
    via the accounts table refresh_token column.
    """
    from sqlalchemy import text as sql_text

    account_id = int(params.get("accountId", params.get("account_id", 0)))
    if not account_id:
        return {"success": False, "message": "accountId is required"}

    async def _op(session):
        r = await session.execute(
            sql_text("SELECT id, email, provider, refresh_token, access_token "
                     "FROM accounts WHERE id = :id"),
            {"id": account_id},
        )
        row = r.first()
        if not row:
            return {"success": False, "message": f"Account {account_id} not found"}

        refresh_token = row[3]
        if not refresh_token:
            return {
                "success": False,
                "message": "No refresh token available. Please re-authenticate.",
            }

        # Token refresh would require provider-specific OAuth logic
        # For now return a structured response indicating refresh is needed
        return {
            "success": False,
            "message": "Token refresh requires provider-specific implementation. "
                       "Please re-authenticate through the OAuth flow.",
            "accountId": account_id,
            "email": row[1],
            "provider": row[2],
        }

    return await run_in_read_session(_op)
