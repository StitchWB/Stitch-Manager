"""Model Sync commands — catalog, status, preview, apply, restore.

Names are deliberately ``model_sync_*`` so they can never collide with the
opencode_dual plugin-routed command names (``get_opencode_config`` etc.).
"""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command
from stitch_backend.domains.ai_proxy.model_sync import opencode_credentials, service
from stitch_backend.domains.ai_proxy.model_sync.catalog import load_catalog
from stitch_backend.domains.ai_proxy.model_sync.detection import check_stitch_credential


def _error(exc: BaseException) -> str:
    return str(exc)[:300]


@register_command("model_sync_catalog", readonly=True)
async def cmd_model_sync_catalog(params: dict) -> dict:
    """Read-only catalog of gateway public models in sync-consumable shape."""
    try:
        catalog = await load_catalog()
        # outputTokensExplicit is an internal hint for the omp writer — strip it
        public = [{k: v for k, v in e.items() if k != "outputTokensExplicit"} for e in catalog]
        return {"ok": True, "models": public, "count": len(public)}
    except Exception as exc:
        return {"ok": False, "error": _error(exc)}


@register_command("model_sync_status", readonly=True)
async def cmd_model_sync_status(params: dict) -> dict:
    """Read-only detection: opencode version/layout/credentials + omp profiles."""
    try:
        return await service.status(params)
    except Exception as exc:
        return {"ok": False, "error": _error(exc)}


@register_command("model_sync_preview", readonly=True)
async def cmd_model_sync_preview(params: dict) -> dict:
    """Read-only preview: per-model diffs + per-file unified diffs (token redacted)."""
    try:
        return await service.preview(params)
    except Exception as exc:
        return {"ok": False, "error": _error(exc)}


@register_command("model_sync_apply", admin_only=True)
async def cmd_model_sync_apply(params: dict) -> dict:
    """Write configs.  Requires the expectedSha256 map from model_sync_preview."""
    try:
        return await service.apply(params)
    except Exception as exc:
        return {"ok": False, "error": _error(exc)}


@register_command("model_sync_opencode_credential_repair", timeout=90, admin_only=True)
async def cmd_model_sync_opencode_credential_repair(params: dict) -> dict:
    """Repair the opencode v2 credential for the currently configured managed key.

    Repair is intentionally narrow: if the key in the opencode config does not
    exactly match an enabled model-sync install key, the caller must run apply
    instead.  This prevents the repair endpoint from turning arbitrary config
    text into a stored credential.
    """
    try:
        configured_key = service.extract_target_configured_key("opencode", params)
        if not configured_key:
            return {"ok": False, "requiresApply": True, "reason": "no stitch apiKey configured"}

        materials, _ = await service.resolve_key_materials(["opencode"], params, provision=False)
        material = materials.get("opencode")
        if material is None or material.action != "reuse" or material.raw != configured_key:
            return {
                "ok": False,
                "requiresApply": True,
                "reason": "configured key is not an enabled model-sync install key",
            }

        probe = check_stitch_credential(configured_key)
        if probe.get("status") == "credential-match":
            return {"ok": True, "alreadyValid": True, "probe": probe, "requiresApply": False}

        import asyncio

        repair = await asyncio.to_thread(
            opencode_credentials.repair_stitch_credential,
            configured_key,
            config_path=params.get("opencodeConfigPath"),
            stale_key_hashes=set(material.stale_key_hashes),
        )
        repair["requiresApply"] = False
        return repair
    except Exception as exc:
        return {"ok": False, "error": _error(exc)}


@register_command("model_sync_restore")
async def cmd_model_sync_restore(params: dict) -> dict:
    """Restore one or more files from backups written by apply."""
    try:
        return await service.restore(params)
    except Exception as exc:
        return {"ok": False, "error": _error(exc)}


__all__ = [
    "cmd_model_sync_apply",
    "cmd_model_sync_catalog",
    "cmd_model_sync_opencode_credential_repair",
    "cmd_model_sync_preview",
    "cmd_model_sync_restore",
    "cmd_model_sync_status",
]
