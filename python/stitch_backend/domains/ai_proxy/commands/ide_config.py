"""IDE detection & configuration commands."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.ai_proxy.model_sync.opencode import (
    STITCH_PROVIDER_ID,
    merge_stitch_block,
)
from stitch_backend.domains.opencode_config.service import (
    read_snapshot,
    write_config,
)

_BACKUP_SUFFIX = ".stitch-backup"


def _gateway_base_url() -> str:
    from stitch_backend.config import get_settings

    settings = get_settings()
    return f"http://127.0.0.1:{settings.port}{settings.litellm_gateway_model_prefix}"


def _gateway_key() -> str:
    """Legacy gateway-running check; the returned token must not be written."""
    from stitch_backend.domains.ai_proxy.local_auth import get_cached_local_chat_token

    token = get_cached_local_chat_token()
    if not token:
        raise StitchError("Gateway is not running — start the AI proxy first")
    return token


async def _provision_opencode_install_key(path: Path):
    """Provision/reuse the opencode model-sync install key for this config."""
    from stitch_backend.domains.ai_proxy.model_sync import service as model_sync_service

    params = {"opencodeConfigPath": str(path)}
    materials, _ = await model_sync_service.resolve_key_materials(
        ["opencode"], params, provision=True
    )
    material = materials["opencode"]
    if not material.raw:
        raise StitchError("Could not provision the opencode install key")
    return material


async def _planned_opencode_install_key(path: Path):
    """Read-only opencode key plan for previews (never creates DB rows)."""
    from stitch_backend.domains.ai_proxy.model_sync import service as model_sync_service

    params = {"opencodeConfigPath": str(path)}
    materials, _ = await model_sync_service.resolve_key_materials(
        ["opencode"], params, provision=False
    )
    return materials["opencode"]


def _resolve_opencode_path(params: dict) -> Path:
    from stitch_backend.domains.ai_proxy.local_scan import opencode_config_path

    config_path = params.get("configPath")
    if isinstance(config_path, str) and config_path.strip():
        return Path(config_path)
    return opencode_config_path()


def _backup_path(path: Path) -> Path:
    return path.with_name(path.name + _BACKUP_SUFFIX)


async def _catalog_entries() -> list[dict[str, Any]]:
    from stitch_backend.domains.ai_proxy.model_sync.catalog import load_catalog

    return await load_catalog()


async def _stitch_provider_block(api_key: str) -> dict[str, Any]:
    from stitch_backend.domains.ai_proxy.model_sync.opencode import build_v1_provider_block

    entries = await _catalog_entries()
    return build_v1_provider_block(entries, _gateway_base_url(), api_key)


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
    """Point an IDE at the local gateway (currently OpenCode only).

    Internals use the shared model-sync opencode writer (atomic, sha256
    conflict-aware, schema auto → v1 for unknown runtimes).  The response
    shape is exactly the legacy one: success/ide/configPath/baseUrl/models.
    """
    ide_name = params.get("ideName", params.get("ide", ""))
    _require_opencode(ide_name)

    path = _resolve_opencode_path(params)
    try:
        snapshot = read_snapshot(path)
    except (json.JSONDecodeError, ValueError, OSError) as exc:
        raise StitchError(f"Cannot read {path}: {exc}") from exc

    # legacy one-shot backup kept for restore_ai_proxy_ide_config compatibility
    backup = _backup_path(path)
    if path.exists() and not backup.exists():
        shutil.copy2(path, backup)

    entries = await _catalog_entries()
    _gateway_key()  # gateway-running check only — the legacy local token is never written
    material = await _provision_opencode_install_key(path)
    assert material.raw is not None  # guaranteed by _provision_opencode_install_key
    # schema auto: unknown runtimes get v1-compatible output (v2 normalizes it)
    try:
        merged = merge_stitch_block(snapshot.data, entries, _gateway_base_url(), material.raw, "v1")
        result = write_config(path, merged, expected_sha256=snapshot.sha256)
    except Exception:
        if material.created_key_id:
            from stitch_backend.domains.ai_proxy.model_sync import key_material

            await key_material.revoke_install_keys([material.created_key_id])
        raise
    if not result.get("ok"):
        if material.created_key_id:
            from stitch_backend.domains.ai_proxy.model_sync import key_material

            await key_material.revoke_install_keys([material.created_key_id])
        raise StitchError(f"Cannot write {path}: {result.get('error', 'conflict')}")

    if material.superseded_key_ids:
        from stitch_backend.domains.ai_proxy.model_sync import key_material

        await key_material.revoke_install_keys(material.superseded_key_ids)

    return {
        "success": True,
        "ide": ide_name,
        "configPath": str(path),
        "baseUrl": _gateway_base_url(),
        "models": sorted(e["id"] for e in entries),
    }


@register_command("get_ai_proxy_ide_config_preview")
async def cmd_get_ai_proxy_ide_config_preview(params: dict) -> str:
    """Preview the IDE configuration that would be written (returns str)."""
    ide_name = params.get("ideName", params.get("ide", ""))
    _require_opencode(ide_name)

    path = _resolve_opencode_path(params)
    material = await _planned_opencode_install_key(path)
    from stitch_backend.domains.ai_proxy.model_sync import service as model_sync_service

    key_for_shape = material.raw or model_sync_service.KEY_SENTINEL
    preview = {"provider": {STITCH_PROVIDER_ID: await _stitch_provider_block(key_for_shape)}}
    # This legacy endpoint returns a full JSON document, so redact both exact
    # key material and generic apiKey assignments before returning it.
    legacy_token = None
    try:
        legacy_token = _gateway_key()
    except StitchError:
        pass
    return model_sync_service._redact(  # noqa: SLF001 — shared backend redactor
        json.dumps(preview, indent=2), legacy_token, [key_for_shape]
    )


@register_command("restore_ai_proxy_ide_config")
async def cmd_restore_ai_proxy_ide_config(params: dict) -> dict:
    """Restore the IDE config from the backup written before configuration."""
    path = _resolve_opencode_path(params)
    backup = _backup_path(path)
    if not backup.exists():
        raise StitchError("No Stitch backup found to restore")
    shutil.copy2(backup, path)
    return {"success": True, "configPath": str(path), "restoredFrom": str(backup)}
