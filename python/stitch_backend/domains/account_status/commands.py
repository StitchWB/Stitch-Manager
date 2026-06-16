"""Account Status command handlers — 5 commands.

Ported from Rust ``commands/account/active.rs``.
"""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session


# ── Status checks ─────────────────────────────────────────────────────────────

@register_command("check_account_status")
async def cmd_check_status(params: dict) -> dict:
    """Check account status with auto-detection of provider."""
    from stitch_backend.domains.account_status import service
    account_id = int(params.get("accountId", params.get("account_id", 0)))

    async def _op(db):
        return await service.check_account_status(db, account_id)

    return await run_in_session(_op)


@register_command("check_windsurf_balance")
async def cmd_check_windsurf(params: dict) -> dict:
    """Check Windsurf account balance using API key."""
    from stitch_backend.domains.account_status import service
    api_key = str(params.get("apiKey", params.get("api_key", "")))
    return await service.check_windsurf_balance(api_key)


# ── Profile session commands ──────────────────────────────────────────────────

@register_command("open_account_profile_session")
async def cmd_open_profile_session(params: dict) -> None:
    """Open a profile session for an account."""
    from stitch_backend.domains.account_status import service
    account_id = int(params.get("accountId", params.get("account_id", 0)))

    async def _op(db):
        return await service.open_account_profile_session(db, account_id)

    return await run_in_session(_op)


@register_command("confirm_account_profile_session")
async def cmd_confirm_profile_session(params: dict) -> None:
    """Confirm manual login for a profile session."""
    from stitch_backend.domains.account_status import service
    account_id = int(params.get("accountId", params.get("account_id", 0)))

    async def _op(db):
        return await service.confirm_account_profile_session(db, account_id)

    return await run_in_session(_op)


@register_command("clear_account_profile_session")
async def cmd_clear_profile_session(params: dict) -> None:
    """Clear profile session data for an account."""
    from stitch_backend.domains.account_status import service
    account_id = int(params.get("accountId", params.get("account_id", 0)))

    async def _op(db):
        return await service.clear_account_profile_session(db, account_id)

    return await run_in_session(_op)
