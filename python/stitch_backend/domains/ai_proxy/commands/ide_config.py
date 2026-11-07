"""IDE detection & configuration commands."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError

_BACKUP_SUFFIX = ".stitch-backup"
_STITCH_PROVIDER_ID = "stitch"
_STITCH_PROVIDER_NPM = "@ai-sdk/openai-compatible"
_DEFAULT_CONTEXT_TOKENS = 128000
_DEFAULT_OUTPUT_TOKENS = 8192


def _gateway_base_url() -> str:
    from stitch_backend.config import get_settings

    settings = get_settings()
    return f"http://127.0.0.1:{settings.port}{settings.litellm_gateway_model_prefix}"


def _gateway_key() -> str:
    from stitch_backend.domains.ai_proxy.local_auth import get_cached_local_chat_token

    token = get_cached_local_chat_token()
    if not token:
        raise StitchError("Gateway is not running — start the AI proxy first")
    return token


def _resolve_opencode_path(params: dict) -> Path:
    from stitch_backend.domains.ai_proxy.local_scan import opencode_config_path

    config_path = params.get("configPath")
    if isinstance(config_path, str) and config_path.strip():
        return Path(config_path)
    return opencode_config_path()


def _backup_path(path: Path) -> Path:
    return path.with_name(path.name + _BACKUP_SUFFIX)


def _read_config(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (json.JSONDecodeError, OSError) as exc:
        raise StitchError(f"Cannot read {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise StitchError(f"{path} is not a JSON object")
    return data


def _write_config(path: Path, config: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")


async def _available_models() -> dict[str, Any]:
    from stitch_backend.database import run_in_read_session
    from stitch_backend.domains.ai_gateway.routing_engine import PoolScope, RoutingEngine

    async def _load(session):
        return await RoutingEngine().get_available_public_models(session, pool=PoolScope(None))

    models = await run_in_read_session(_load)
    catalog: dict[str, Any] = {}
    for model in models:
        contract = model.contract or {}
        context = contract.get("minContextTokens")
        if not isinstance(context, int) or context <= 0:
            context = _DEFAULT_CONTEXT_TOKENS
        catalog[model.id] = {
            "name": model.display_name or model.id,
            "limit": {"context": context, "output": _DEFAULT_OUTPUT_TOKENS},
        }
    return catalog


async def _stitch_provider_block(api_key: str) -> dict[str, Any]:
    block: dict[str, Any] = {
        "npm": _STITCH_PROVIDER_NPM,
        "name": "Stitch Gateway",
        "options": {"baseURL": _gateway_base_url(), "apiKey": api_key},
    }
    models = await _available_models()
    if models:
        block["models"] = models
    return block


def _require_opencode(ide_name: str) -> None:
    if ide_name != "opencode":
        raise StitchError(
            f"Auto-configuration is not implemented for '{ide_name}' — use the manual payload",
        )


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
            "configPath": ide.config_path,
            "installed": ide.installed,
            "configured": ide.configured,
        }
        for ide in ides
    ]


@register_command("configure_ai_proxy_ide")
async def cmd_configure_ai_proxy_ide(params: dict) -> dict:
    """Point an IDE at the local gateway (currently OpenCode only)."""
    ide_name = params.get("ideName", params.get("ide", ""))
    _require_opencode(ide_name)

    path = _resolve_opencode_path(params)
    config = _read_config(path)
    backup = _backup_path(path)
    if path.exists() and not backup.exists():
        shutil.copy2(path, backup)

    config.setdefault("provider", {})
    block = await _stitch_provider_block(_gateway_key())
    config["provider"][_STITCH_PROVIDER_ID] = block
    _write_config(path, config)

    return {
        "success": True,
        "ide": ide_name,
        "configPath": str(path),
        "baseUrl": _gateway_base_url(),
        "models": sorted(block.get("models", {})),
    }


@register_command("get_ai_proxy_ide_config_preview")
async def cmd_get_ai_proxy_ide_config_preview(params: dict) -> str:
    """Preview the IDE configuration that would be written (returns str)."""
    ide_name = params.get("ideName", params.get("ide", ""))
    _require_opencode(ide_name)

    preview = {"provider": {_STITCH_PROVIDER_ID: await _stitch_provider_block(_gateway_key())}}
    return json.dumps(preview, indent=2)


@register_command("restore_ai_proxy_ide_config")
async def cmd_restore_ai_proxy_ide_config(params: dict) -> dict:
    """Restore the IDE config from the backup written before configuration."""
    path = _resolve_opencode_path(params)
    backup = _backup_path(path)
    if not backup.exists():
        raise StitchError("No Stitch backup found to restore")
    shutil.copy2(backup, path)
    return {"success": True, "configPath": str(path), "restoredFrom": str(backup)}
