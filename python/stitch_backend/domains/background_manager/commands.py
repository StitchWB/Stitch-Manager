"""Background Manager commands — 1 command.

Ported from Rust ``commands/background.rs``.
Returns default config/status since actual background tasks are handled
by dedicated services (replenishment, registration, scheduler).
"""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command

_DEFAULT_CONFIG: dict = {
    "autoRegisterEnabled": False,
    "registerIntervalMinutes": 30,
    "minAccountsThreshold": 5,
    "autoSwitchEnabled": False,
    "switchOnZeroCredits": True,
    "checkCreditsIntervalSeconds": 60,
    "autoRefreshQuotaEnabled": False,
    "refreshQuotaIntervalSeconds": 300,
    "refreshQuotaMaxErrors": 3,
}

_DEFAULT_STATUS: dict = {
    "config": _DEFAULT_CONFIG,
    "isRegistering": False,
    "isSwitching": False,
    "isRefreshingQuota": False,
    "consecutiveErrors": 0,
    "lastRegisterCheck": None,
    "lastSwitchCheck": None,
    "lastQuotaRefreshCheck": None,
    "quotaRefreshErrorCount": 0,
    "quotaTrackedAccounts": 0,
}


@register_command("get_background_manager_status")
async def cmd_get_background_manager_status(params: dict) -> dict:
    """Return background manager status."""
    return _DEFAULT_STATUS


@register_command("get_background_manager_config")
async def cmd_get_background_manager_config(params: dict) -> dict:
    """Return background manager config from settings table."""
    from stitch_backend.database import run_in_session
    from sqlalchemy import text

    async def _op(session):
        result = await session.execute(
            text("SELECT value FROM settings WHERE key = 'background_manager_config'")
        )
        row = result.first()
        if row and row[0]:
            import json
            try:
                return json.loads(row[0])
            except (json.JSONDecodeError, TypeError):
                pass
        return _DEFAULT_CONFIG

    return await run_in_session(_op)


@register_command("update_background_manager_config")
async def cmd_update_background_manager_config(params: dict) -> None:
    """Persist background manager config to settings table."""
    from stitch_backend.database import run_in_session
    from sqlalchemy import text
    import json

    config_json = json.dumps(params)

    async def _op(session):
        await session.execute(
            text(
                "INSERT INTO settings (key, value) VALUES ('background_manager_config', :v) "
                "ON CONFLICT(key) DO UPDATE SET value = :v"
            ),
            {"v": config_json},
        )

    await run_in_session(_op)
