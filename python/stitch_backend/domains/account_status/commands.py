"""Account Status command handlers — 5 commands.

Ported from Rust ``commands/account/active.rs``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.core.command_decorator import command
from stitch_backend.core.command_registry import register_command

# ── Status checks ─────────────────────────────────────────────────────────────

@command("check_account_status")
async def cmd_check_status(db: AsyncSession, params: dict) -> dict:
    """Check account status with auto-detection of provider."""
    from stitch_backend.domains.account_status import service
    account_id = int(params.get("accountId", params.get("account_id", 0)))

    return await service.check_account_status(db, account_id)


@register_command("check_windsurf_balance")
async def cmd_check_windsurf(params: dict) -> dict:
    """Check Windsurf account balance using API key."""
    from stitch_backend.domains.account_status import service
    api_key = str(params.get("apiKey", params.get("api_key", "")))
    return await service.check_windsurf_balance(api_key)


# ── Profile session commands ──────────────────────────────────────────────────

@command("open_account_profile_session")
async def cmd_open_profile_session(db: AsyncSession, params: dict) -> None:
    """Open a profile session for an account."""
    from stitch_backend.domains.account_status import service
    account_id = int(params.get("accountId", params.get("account_id", 0)))

    return await service.open_account_profile_session(db, account_id)


@command("confirm_account_profile_session")
async def cmd_confirm_profile_session(db: AsyncSession, params: dict) -> None:
    """Confirm manual login for a profile session."""
    from stitch_backend.domains.account_status import service
    account_id = int(params.get("accountId", params.get("account_id", 0)))

    return await service.confirm_account_profile_session(db, account_id)


@command("clear_account_profile_session")
async def cmd_clear_profile_session(db: AsyncSession, params: dict) -> None:
    """Clear profile session data for an account."""
    from stitch_backend.domains.account_status import service
    account_id = int(params.get("accountId", params.get("account_id", 0)))

    return await service.clear_account_profile_session(db, account_id)
