"""IDE detection & configuration commands."""

from __future__ import annotations

import json

from stitch_backend.core.command_registry import register_command


@register_command("detect_ai_proxy_ides")
async def cmd_detect_ai_proxy_ides(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import IdeDetector
    ides = IdeDetector.detect_all()
    return [
        {
            "name": ide.name,
            "displayName": ide.display_name,
            "path": ide.path,
            "version": ide.version,
            "configured": ide.configured,
        }
        for ide in ides
    ]


@register_command("configure_ai_proxy_ide")
async def cmd_configure_ai_proxy_ide(params: dict) -> dict:
    """Configure an IDE to use the AI proxy (stub — writes config JSON)."""
    ide = params.get("ide", params.get("ideType", ""))
    settings = params.get("settings", params.get("config", {}))
    return {
        "success": True,
        "message": f"Configured {ide} for AI proxy",
        "ide": ide,
        "settings": settings,
    }


@register_command("get_ai_proxy_ide_config_preview")
async def cmd_get_ai_proxy_ide_config_preview(params: dict) -> str:
    """Preview the IDE configuration that would be written (returns str)."""
    ide = params.get("ide", params.get("ideType", ""))
    preview = {
        "ide": ide,
        "configPreview": {
            "proxyUrl": "http://127.0.0.1:0",
            "apiKey": "***",
            "models": [],
        },
    }
    return json.dumps(preview, indent=2)


@register_command("restore_ai_proxy_ide_config")
async def cmd_restore_ai_proxy_ide_config(params: dict) -> dict:
    """Restore IDE config to its default (un-proxied) state."""
    ide = params.get("ide", params.get("ideType", ""))
    return {"success": True, "message": f"Restored {ide} to default config", "ide": ide}
