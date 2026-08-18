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


@register_command("get_freemodel_bridge_status")
async def cmd_get_freemodel_bridge_status(params: dict) -> dict:
    """Get current bridge process status."""
    from stitch_backend.domains.freemodel_bridge.service import FreemodelBridgeService
    try:
        return FreemodelBridgeService.status()
    except Exception:
        return {"status": "stopped", "port": 0, "pid": 0, "uptimeSeconds": 0, "error": None}


@register_command("get_freemodel_bridge_capabilities")
async def cmd_get_freemodel_bridge_capabilities(params: dict) -> dict:
    """Get bridge capabilities (models, features) via HTTP."""
    import httpx

    from stitch_backend.domains.freemodel_bridge.service import FreemodelBridgeService

    info = FreemodelBridgeService.status()
    port = info.get("port", 0)
    if not port or info.get("status") != "running":
        return {"running": False, "models": [], "capabilities": {}, "version": None}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"http://127.0.0.1:{port}/v1/models")
            data = resp.json()
            models = data.get("data", data.get("models", []))
            return {"running": True, "models": models, "capabilities": {}, "version": None}
    except Exception:
        return {"running": False, "models": [], "capabilities": {}, "version": None}
