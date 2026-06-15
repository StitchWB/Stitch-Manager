"""Settings command handlers."""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session
from stitch_backend.domains.settings.service import SettingsService


@register_command("get_settings")
async def cmd_get_settings(params: dict) -> dict:
    async def _op(session):
        svc = SettingsService(session)
        return await svc.get_all()

    return await run_in_session(_op)


@register_command("update_settings")
async def cmd_update_settings(params: dict) -> dict:
    settings = params.get("settings", params)

    async def _op(session):
        svc = SettingsService(session)
        return await svc.update(settings)

    return await run_in_session(_op)
