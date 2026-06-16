"""Freemodel Bridge command handlers."""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command


@register_command("start_freemodel_bridge")
async def cmd_start_freemodel_bridge(params: dict) -> dict:
    """Start the FreeModel bridge subprocess."""
    from stitch_backend.domains.freemodel_bridge.service import FreemodelBridgeService
    return await FreemodelBridgeService.start(params.get("settings", params))


@register_command("stop_freemodel_bridge")
async def cmd_stop_freemodel_bridge(params: dict) -> dict:
    """Stop the FreeModel bridge subprocess."""
    from stitch_backend.domains.freemodel_bridge.service import FreemodelBridgeService
    return await FreemodelBridgeService.stop()


@register_command("update_freemodel_bridge_settings")
async def cmd_update_freemodel_bridge_settings(params: dict) -> dict:
    """Update bridge settings and restart if running."""
    from stitch_backend.domains.freemodel_bridge.service import FreemodelBridgeService
    settings = params.get("settings", params)
    return await FreemodelBridgeService.update_settings(settings)


@register_command("test_freemodel_bridge_connection")
async def cmd_test_freemodel_bridge_connection(params: dict) -> dict:
    """Test bridge with a simple chat completion request."""
    from stitch_backend.domains.freemodel_bridge.service import FreemodelBridgeService
    model = params.get("model")
    return await FreemodelBridgeService.test_connection(model)
