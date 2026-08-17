"""Marketplace commands — merge official + community + installed state.

Three commands wired to the command registry:

  - ``get_marketplace``              → merge official manifest + community catalog
                                       + local installed state (readonly)
  - ``install_marketplace_plugin``   → official (entitled-gated, signature-verified)
                                       or community install
  - ``uninstall_marketplace_plugin`` → remove local installed copy

Official items come from the stitch_server manifest using the stored
activation.  If no activation or server is unreachable, ``activated`` is
False and official items are empty (the command never fails).

Community items come from the existing community catalog client
(:mod:`.community`); ``entitled=True``, ``can_download=True`` always.

Installed state for official plugins is read from
:func:`autoreg.plugin.install.list_installed_versions`; for community
plugins from :func:`.community.list_installed_community`.
"""

from __future__ import annotations

import logging
import shutil
from typing import Any

import httpx

from autoreg.plugin.install import list_installed_versions
from autoreg.plugin.layout import plugin_cache_path, plugins_cache_dir
from autoreg.plugin.manifest import parse_semver
from stitch_backend.core.command_registry import register_command

from .activation import ActivationService
from .community import (
    _community_root,
    fetch_catalog,
    install_community,
    list_installed_community,
)
from .sync import PluginSyncService

logger = logging.getLogger(__name__)


# ── get_marketplace ──────────────────────────────────────────────────────────


@register_command("get_marketplace", readonly=True)
async def cmd_get_marketplace(params: dict) -> dict:
    """Merge official + community + installed state into one list.

    Returns ``{"activated": bool, "items": [...]}``.
    Never raises — server/catalog failures degrade to empty lists.
    """
    items: list[dict[str, Any]] = []

    # ── Official items from server manifest ──────────────────────────────────
    activation = ActivationService()
    state = activation.load()
    activated = state is not None
    if state is not None and not state.degraded:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                sync = PluginSyncService(activation, client=client)
                manifest = await sync.fetch_manifest(state.token)
            for entry in manifest.get("plugins", []):
                plugin_id = str(entry.get("id", ""))
                version = str(entry.get("version", ""))
                entitled = entry.get("entitled", True)
                if not plugin_id or not version:
                    continue
                installed_versions = list_installed_versions(plugin_id)
                installed = bool(installed_versions)
                installed_version = (
                    max(installed_versions, key=lambda v: _safe_semver(v))
                    if installed_versions
                    else None
                )
                name = _read_installed_name(plugin_id, installed_version) or plugin_id
                items.append(
                    {
                        "id": plugin_id,
                        "name": name,
                        "description": None,
                        "version": version,
                        "source": "official",
                        "entitled": bool(entitled),
                        "installed": installed,
                        "installed_version": installed_version,
                        "can_download": bool(entitled),
                    }
                )
        except Exception as exc:  # noqa: BLE001 — marketplace must not crash
            logger.warning("Marketplace: official manifest fetch failed: %s", exc)
            activated = False

    # ── Community items from catalog ─────────────────────────────────────────
    try:
        catalog = fetch_catalog()
        installed_community = {
            (p["id"], p["version"]): p for p in list_installed_community()
        }
        for entry in catalog.get("plugins", []):
            if not isinstance(entry, dict):
                continue
            plugin_id = str(entry.get("id", ""))
            version = str(entry.get("version", ""))
            if not plugin_id or not version:
                continue
            name = str(entry.get("name", plugin_id))
            description = entry.get("description")
            is_installed = (plugin_id, version) in installed_community
            installed_version = version if is_installed else None
            items.append(
                {
                    "id": plugin_id,
                    "name": name,
                    "description": description,
                    "version": version,
                    "source": "community",
                    "entitled": True,
                    "installed": is_installed,
                    "installed_version": installed_version,
                    "can_download": True,
                }
            )
    except Exception as exc:  # noqa: BLE001 — marketplace must not crash
        logger.warning("Marketplace: community catalog fetch failed: %s", exc)

    return {"activated": activated, "items": items}


# ── install_marketplace_plugin ────────────────────────────────────────────────


@register_command("install_marketplace_plugin")
async def cmd_install_marketplace_plugin(params: dict) -> dict:
    """Install a plugin from the official or community channel.

    Params: ``{id, source}`` where source is ``"official"`` or ``"community"``.
    Official requires activation + entitled; community reuses the existing
    community install flow.  Returns ``{"success": bool, "error": str | null}``.
    """
    plugin_id = str(params.get("id", ""))
    source = str(params.get("source", ""))
    if not plugin_id or not source:
        return {"success": False, "error": "id and source required"}

    if source == "official":
        return await _install_official(plugin_id)
    if source == "community":
        return await _install_community_latest(plugin_id)
    return {"success": False, "error": f"unknown source: {source}"}


async def _install_official(plugin_id: str) -> dict[str, Any]:
    """Install an official plugin: require activation + entitled, then sync-install."""
    activation = ActivationService()
    state = activation.load()
    if state is None:
        return {"success": False, "error": "not activated"}
    if state.degraded:
        return {"success": False, "error": "activation degraded (revoked token)"}

    async with httpx.AsyncClient(timeout=60.0) as client:
        sync = PluginSyncService(activation, client=client)
        try:
            manifest = await sync.fetch_manifest(state.token)
        except Exception as exc:  # noqa: BLE001 — surface as command error
            return {"success": False, "error": f"manifest fetch failed: {exc}"}

        # Find the plugin entry in the manifest.
        entry = None
        for e in manifest.get("plugins", []):
            if str(e.get("id", "")) == plugin_id:
                entry = e
                break
        if entry is None:
            return {"success": False, "error": f"plugin not in manifest: {plugin_id}"}

        version = str(entry.get("version", ""))
        if not version:
            return {"success": False, "error": "manifest entry missing version"}

        entitled = entry.get("entitled", True)
        if entitled is False:
            return {"success": False, "error": "not entitled to this plugin"}

        # Download + install (signature-verified atomic install).
        # Surface 403 (server-side entitlement gate) as a command error.
        try:
            await sync._download_and_install(  # noqa: SLF001 — reuse sync internals
                plugin_id, version, state.token, state.pubkey
            )
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status == 403:
                return {"success": False, "error": "server denied download (403)"}
            return {"success": False, "error": f"download failed ({status}): {exc}"}
        except Exception as exc:  # noqa: BLE001 — surface as command error
            return {"success": False, "error": f"install failed: {exc}"}

    return {"success": True, "error": None}


async def _install_community_latest(plugin_id: str) -> dict[str, Any]:
    """Install the latest community version from the catalog."""
    catalog = fetch_catalog()
    versions = [
        str(e.get("version", ""))
        for e in catalog.get("plugins", [])
        if isinstance(e, dict) and str(e.get("id", "")) == plugin_id
    ]
    if not versions:
        return {"success": False, "error": f"not in catalog: {plugin_id}"}
    latest = max(versions, key=lambda v: _safe_semver(v))
    return await install_community(plugin_id, latest)


# ── uninstall_marketplace_plugin ──────────────────────────────────────────────


@register_command("uninstall_marketplace_plugin")
async def cmd_uninstall_marketplace_plugin(params: dict) -> dict:
    """Remove a locally installed plugin (official cache or community dir).

    Params: ``{id, source}``.  Returns ``{"success": bool, "error": str | null}``.
    """
    plugin_id = str(params.get("id", ""))
    source = str(params.get("source", ""))
    if not plugin_id or not source:
        return {"success": False, "error": "id and source required"}

    if source == "official":
        return _uninstall_official(plugin_id)
    if source == "community":
        return _uninstall_community(plugin_id)
    return {"success": False, "error": f"unknown source: {source}"}


def _uninstall_official(plugin_id: str) -> dict[str, Any]:
    """Remove all installed versions of an official plugin from the cache."""
    plugin_root = plugins_cache_dir() / plugin_id
    if not plugin_root.is_dir():
        return {"success": False, "error": "not installed"}
    shutil.rmtree(plugin_root, ignore_errors=True)
    if plugin_root.is_dir():
        return {"success": False, "error": "failed to remove plugin directory"}
    return {"success": True, "error": None}


def _uninstall_community(plugin_id: str) -> dict[str, Any]:
    """Remove a community plugin (all versions) from the community dir."""
    root = _community_root() / plugin_id
    if not root.is_dir():
        return {"success": False, "error": "not installed"}
    shutil.rmtree(root, ignore_errors=True)
    if root.is_dir():
        return {"success": False, "error": "failed to remove plugin directory"}
    return {"success": True, "error": None}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _safe_semver(version: str) -> tuple[int, int, int]:
    """Parse semver, returning (0,0,0) on failure (sorts oldest)."""
    try:
        return parse_semver(version)
    except ValueError:
        return (0, 0, 0)


def _read_installed_name(plugin_id: str, version: str | None) -> str | None:
    """Best-effort read of the plugin name from an installed package."""
    if version is None:
        return None
    import json

    manifest_path = plugin_cache_path(plugin_id, version) / "plugin.json"
    if not manifest_path.is_file():
        return None
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            name = raw.get("name")
            if isinstance(name, str) and name:
                return name
    except (OSError, ValueError):
        pass
    return None
