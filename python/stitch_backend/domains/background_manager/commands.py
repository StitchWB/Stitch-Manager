"""Background Manager configuration commands."""

from __future__ import annotations

import json

from typing import cast

from sqlalchemy import text

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.background_manager.schemas import (
    BackgroundManagerConfig,
    normalise_background_manager_config,
)

_DEFAULT_STATUS: dict = {
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


async def _load_config() -> BackgroundManagerConfig:
    async def _op(session):
        result = await session.execute(
            text("SELECT value FROM settings WHERE key = 'background_manager_config'")
        )
        row = result.first()
        if not row or not row[0]:
            return BackgroundManagerConfig.model_validate({})
        try:
            value = json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            return BackgroundManagerConfig.model_validate({})
        return normalise_background_manager_config(value)

    return cast(BackgroundManagerConfig, await run_in_read_session(_op))


@register_command("get_background_manager_status", readonly=True)
async def cmd_get_background_manager_status(params: dict) -> dict:
    """Return static worker status with the effective persisted config."""
    config = await _load_config()
    return {
        "config": config.model_dump(mode="json", by_alias=True),
        **_DEFAULT_STATUS,
    }


@register_command("get_background_manager_config", readonly=True)
async def cmd_get_background_manager_config(params: dict) -> dict:
    """Return a validated, default-complete background manager config."""
    config = await _load_config()
    return config.model_dump(mode="json", by_alias=True)


@register_command("update_background_manager_config")
async def cmd_update_background_manager_config(params: dict) -> None:
    """Persist frontend ``{config}`` envelopes and legacy raw config bodies."""
    raw_config = params.get("config", params)
    config = BackgroundManagerConfig.model_validate(raw_config)
    config_json = config.model_dump_json(by_alias=True)

    async def _op(session):
        await session.execute(
            text(
                "INSERT INTO settings (key, value) VALUES ('background_manager_config', :v) "
                "ON CONFLICT(key) DO UPDATE SET value = :v"
            ),
            {"v": config_json},
        )

    await run_in_session(_op)
