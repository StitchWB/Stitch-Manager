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
