"""Marketplace commands — merge official + community + installed state.

Commands:
  - ``get_marketplace``              → official manifest + community catalog (readonly)
  - ``install_marketplace_plugin``   → official (entitlement-gated) or community
  - ``uninstall_marketplace_plugin`` → remove local installed copy

Official entitlement is computed LOCALLY from ``state.entitlements``
(``"*"`` = all; else plugin-id membership), not from the server manifest.
If no activation or server unreachable, ``activated`` is False and
official items are empty — community items are still returned.

Installed state for official plugins is read from
:func:`autoreg.plugin.install.list_installed_versions`; for community
plugins from :func:`.community.list_installed_community`.  On web builds
where no official plugin is installed locally, ``installed=False``.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import time
from typing import Any

import httpx

from autoreg.plugin.install import list_installed_versions
from autoreg.plugin.layout import plugins_cache_dir
from autoreg.plugin.manifest import parse_semver
from stitch_backend.core.command_registry import register_command

from .activation import ActivationService
from .community import (
    _community_root,
    fetch_catalog,
    install_community,
    list_installed_community,
)
from .entitlements import (
    get_effective_entitlements,
    get_required_tiers,
    is_entitled_to,
)
from .sync import PluginSyncService

logger = logging.getLogger(__name__)


def _is_entitled(plugin_id: str, entitlements: list[str]) -> bool:
    """True if ``plugin_id`` is entitled per ``state.entitlements``.

    ``"*"`` in the list = all plugins; else exact plugin-id membership.
    """
    return "*" in entitlements or plugin_id in entitlements


def _caller_uses_grants(params: dict) -> bool:
    """True when the grants path should be used for entitlement resolution.

    FIX 4 (P1): the grants path must be used whenever auth is enabled,
    regardless of caller context.  When auth is disabled (desktop), the
    legacy ``.activation`` path is used.  This prevents a guest (auth
    enabled, no caller context) from falling through to the legacy path
    which may contain a wildcard from an old activation.
    """
    from stitch_backend.config import get_settings
    return get_settings().auth_enabled


def _safe_semver(version: str) -> tuple[int, int, int]:
    """Parse semver, returning (0,0,0) on failure (sorts oldest)."""
    try:
        return parse_semver(version)
    except ValueError:
        return (0, 0, 0)


# ── Short-TTL cache for upstream feeds (marketplace perf) ────────────────────
# The official manifest (distribution server) and community catalog (GitHub)
# are network-bound and change slowly; re-fetching them on every page load
# made the marketplace hang for up to the upstream timeout.  Cache both for a
# short TTL and fetch them concurrently with a short timeout so a slow
# upstream degrades to an empty list quickly instead of blocking the page.
_FEED_CACHE_TTL = 60.0
_feed_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _cache_get(key: str) -> dict[str, Any] | None:
    hit = _feed_cache.get(key)
    if hit is not None and (time.monotonic() - hit[0]) < _FEED_CACHE_TTL:
        return hit[1]
    return None


def _cache_set(key: str, value: dict[str, Any]) -> None:
    _feed_cache[key] = (time.monotonic(), value)


def _clear_feed_cache() -> None:
    """Test/ops hook: drop cached upstream feeds (isolation / force refresh)."""
    _feed_cache.clear()


async def _fetch_manifest_cached(activation: ActivationService, token: str) -> dict:
    cached = _cache_get("manifest")
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=10.0) as client:
        sync = PluginSyncService(activation, client=client)
        manifest = await sync.fetch_manifest(token)
    _cache_set("manifest", manifest)
    return manifest


async def _fetch_catalog_cached() -> dict:
    cached = _cache_get("catalog")
    if cached is not None:
        return cached
    # fetch_catalog is a blocking GitHub fetch — run off the event loop.
    catalog = await asyncio.to_thread(fetch_catalog)
    _cache_set("catalog", catalog)
    return catalog


async def _fetch_public_catalog_cached(activation: ActivationService) -> dict:
    """Public official listing (no token) for the unactivated marketplace."""
    cached = _cache_get("catalog_public")
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=10.0) as client:
        sync = PluginSyncService(activation, client=client)
        catalog = await sync.fetch_public_catalog()
    _cache_set("catalog_public", catalog)
    return catalog


@register_command("get_marketplace", readonly=True)
async def cmd_get_marketplace(params: dict) -> dict:
    """Merge official + community + installed state into one list.

    Returns ``{"activated": bool, "items": [...]}``.
    Never raises — server/catalog failures degrade to empty lists.

    Entitlement dual-path:
      - Auth enabled (caller context) → ``get_effective_entitlements``.
      - Desktop / no-auth → legacy ``state.entitlements`` from ``.activation``.
    Community items are always entitled (unchanged).
    """
    items: list[dict[str, Any]] = []

    activation = ActivationService()
    state = activation.load()
    activated = state is not None

    # Dual-path entitlement resolution.
    use_grants = _caller_uses_grants(params)
    if use_grants:
        caller_user_id = params.get("_caller_user_id")
        caller_role = params.get("_caller_role")
        grant_entitlements = await get_effective_entitlements(
            caller_user_id, caller_role
        )

    # Fetch the two upstream feeds concurrently (cached, short timeout) so a
    # slow upstream degrades fast instead of blocking the marketplace page.
    catalog_task = asyncio.create_task(_fetch_catalog_cached())

    if state is not None and not state.degraded:
        try:
            manifest = await _fetch_manifest_cached(activation, state.token)
            # FIX 5 (P1): bulk-fetch required tiers in a single DB query
            # instead of N+1 per-plugin get_required_tier calls.
            manifest_plugin_ids = [
                str(e.get("id", ""))
                for e in manifest.get("plugins", [])
                if isinstance(e, dict) and e.get("id") and e.get("version")
            ]
            required_tiers = await get_required_tiers(manifest_plugin_ids)
            for entry in manifest.get("plugins", []):
                plugin_id = str(entry.get("id", ""))
                version = str(entry.get("version", ""))
                if not plugin_id or not version:
                    continue
                if use_grants:
                    entitled = is_entitled_to(plugin_id, grant_entitlements)
                else:
                    entitled = _is_entitled(plugin_id, state.entitlements)
                installed_versions = list_installed_versions(plugin_id)
                installed = bool(installed_versions)
                installed_version = (
                    max(installed_versions, key=lambda v: _safe_semver(v))
                    if installed_versions
                    else None
                )
                items.append(
                    {
                        "id": plugin_id,
                        "name": plugin_id,
                        "description": entry.get("description"),
                        "author": entry.get("author"),
                        "version": version,
                        "source": "official",
                        "entitled": entitled,
                        "installed": installed,
                        "installed_version": installed_version,
                        "can_download": entitled,
                        "required_tier": required_tiers.get(plugin_id),
                    }
                )
        except Exception as exc:  # noqa: BLE001 — marketplace must not crash
            logger.warning("Marketplace: official manifest fetch failed: %s", exc)
            activated = False
    elif state is None:
        # No activation: official plugins stay VISIBLE but locked — the
        # marketplace is the funnel; downloads require activation.
        try:
            public_catalog = await _fetch_public_catalog_cached(activation)
            public_ids = [
                str(e.get("id", ""))
                for e in public_catalog.get("plugins", [])
                if isinstance(e, dict) and e.get("id") and e.get("version")
            ]
            public_tiers = await get_required_tiers(public_ids)
            for entry in public_catalog.get("plugins", []):
                plugin_id = str(entry.get("id", ""))
                version = str(entry.get("version", ""))
                if not plugin_id or not version:
                    continue
                installed_versions = list_installed_versions(plugin_id)
                items.append(
                    {
                        "id": plugin_id,
                        "name": str(entry.get("name") or plugin_id),
                        "description": entry.get("description"),
                        "author": entry.get("author"),
                        "version": version,
                        "source": "official",
                        "entitled": False,
                        "installed": bool(installed_versions),
                        "installed_version": (
                            max(installed_versions, key=lambda v: _safe_semver(v))
                            if installed_versions
                            else None
                        ),
                        "can_download": False,
                        "required_tier": public_tiers.get(plugin_id),
                    }
                )
        except Exception as exc:  # noqa: BLE001 — marketplace must not crash
            logger.warning("Marketplace: public catalog fetch failed: %s", exc)

    try:
        catalog = await catalog_task
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
            is_installed = (plugin_id, version) in installed_community
            items.append(
                {
                    "id": plugin_id,
                    "name": name,
                    "description": entry.get("description"),
                    "author": entry.get("author"),
                    "version": version,
                    "source": "community",
                    "entitled": True,
                    "installed": is_installed,
                    "installed_version": version if is_installed else None,
                    "can_download": True,
                }
            )
    except Exception as exc:  # noqa: BLE001 — marketplace must not crash
        logger.warning("Marketplace: community catalog fetch failed: %s", exc)

    return {"activated": activated, "items": items}


@register_command("install_marketplace_plugin")
async def cmd_install_marketplace_plugin(params: dict) -> dict:
    """Install a plugin from the official or community channel.

    Params: ``{id, source}``.  Official requires activation + local
    entitlement; community reuses the existing community install flow.
    """
    plugin_id = str(params.get("id", ""))
    source = str(params.get("source", ""))
    if not plugin_id or not source:
        return {"success": False, "error": "id and source required"}

    if source == "official":
        return await _install_official(plugin_id, params)
    if source == "community":
        return await _install_community_latest(plugin_id)
    return {"success": False, "error": f"unknown source: {source}"}


async def _install_official(plugin_id: str, params: dict | None = None) -> dict[str, Any]:
    """Install an official plugin: activation + local entitlement, then sync.

    Entitlement dual-path mirrors :func:`cmd_get_marketplace`:
      - Auth enabled (caller context in ``params``) → grant service.
      - Desktop / no-auth → legacy ``state.entitlements``.
    """
    activation = ActivationService()
    state = activation.load()
    if state is None:
        return {"success": False, "error": "not activated"}
    if state.degraded:
        return {"success": False, "error": "activation degraded (revoked token)"}

    # Dual-path entitlement check.
    params = params or {}
    use_grants = _caller_uses_grants(params)
    if use_grants:
        caller_user_id = params.get("_caller_user_id")
        caller_role = params.get("_caller_role")
        grant_entitlements = await get_effective_entitlements(
            caller_user_id, caller_role
        )
        if not is_entitled_to(plugin_id, grant_entitlements):
            return {"success": False, "error": "not entitled to this plugin"}
    else:
        if not _is_entitled(plugin_id, state.entitlements):
            return {"success": False, "error": "not entitled to this plugin"}

    async with httpx.AsyncClient(timeout=60.0) as client:
        sync = PluginSyncService(activation, client=client)
        try:
            manifest = await sync.fetch_manifest(state.token)
        except Exception as exc:  # noqa: BLE001 — surface as command error
            return {"success": False, "error": f"manifest fetch failed: {exc}"}

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


@register_command("uninstall_marketplace_plugin")
async def cmd_uninstall_marketplace_plugin(params: dict) -> dict:
    """Remove a locally installed plugin (official cache or community dir).

    Params: ``{id, source}``.
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
