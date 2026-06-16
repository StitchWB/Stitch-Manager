"""Replenishment command handlers — registered via ``@register_command``.

Commands:
    - ``get_replenishment_status``  — current status of the background service
    - ``start_replenishment``       — start the background auto-register loop
    - ``stop_replenishment``        — stop the loop
    - ``trigger_replenishment``     — manually trigger one check cycle
    - ``get_replenishment_settings`` — read current thresholds from settings
    - ``get_active_account_counts`` — count active accounts per provider
"""

from __future__ import annotations

import logging
from typing import Any

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session

logger = logging.getLogger(__name__)


@register_command("get_replenishment_status")
async def cmd_get_status(params: dict) -> dict:
    """Return current replenishment service status."""
    from stitch_backend.domains.replenishment.service import get_replenishment_service
    svc = get_replenishment_service()
    status = svc.status.to_dict()
    status["serviceRunning"] = svc.is_running
    return status


@register_command("start_replenishment")
async def cmd_start(params: dict) -> dict:
    """Start the background auto-replenishment loop."""
    from stitch_backend.domains.replenishment.service import get_replenishment_service
    svc = get_replenishment_service()
    await svc.start()
    return {"running": True}


@register_command("stop_replenishment")
async def cmd_stop(params: dict) -> dict:
    """Stop the background auto-replenishment loop."""
    from stitch_backend.domains.replenishment.service import get_replenishment_service
    svc = get_replenishment_service()
    await svc.stop()
    return {"running": False}


@register_command("trigger_replenishment")
async def cmd_trigger(params: dict) -> dict:
    """Manually trigger one replenishment check cycle."""
    from stitch_backend.domains.replenishment.service import get_replenishment_service
    svc = get_replenishment_service()
    await svc._check_and_replenish()
    return svc.status.to_dict()


@register_command("get_replenishment_settings")
async def cmd_get_settings(params: dict) -> dict:
    """Read replenishment thresholds from settings."""
    from stitch_backend.domains.replenishment.service import get_replenishment_service
    svc = get_replenishment_service()
    settings = await svc._load_settings()
    return {
        "autoReplenishEnabled": settings.auto_replenish_enabled,
        "minActiveKiro": settings.min_active_kiro,
        "minActiveWindsurf": settings.min_active_windsurf,
        "minActiveTrae": settings.min_active_trae,
        "kiroRegStrategy": settings.kiro_reg_strategy,
        "windsurfRegStrategy": settings.windsurf_reg_strategy,
        "traeRegStrategy": settings.trae_reg_strategy,
    }


@register_command("get_active_account_counts")
async def cmd_get_counts(params: dict) -> list:
    """Count active accounts grouped by provider."""
    from sqlalchemy import text

    async def _op(session):
        rows = (await session.execute(text(
            "SELECT LOWER(provider) AS provider, COUNT(*) AS count "
            "FROM accounts "
            "WHERE status IN ('active', 'valid', 'online') "
            "GROUP BY LOWER(provider)"
        ))).fetchall()

        return [
            {"provider": row[0], "count": row[1]}
            for row in rows
        ]

    return await run_in_session(_op)
