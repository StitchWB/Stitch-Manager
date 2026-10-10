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
from autoreg.plugin.layout import plugins_cache_dir, plugins_local_dir, resolve_link
from autoreg.plugin.manifest import parse_semver, resolve_i18n, validate_manifest
from stitch_backend.core.command_registry import register_command
from stitch_backend.core.shared_http import shared_ssl_context

from .activation import ActivationService
from .community import (
    _community_root,
    fetch_catalog,
    install_community,
    install_server_community,
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


def _badges_of(entry: dict[str, Any]) -> list[str]:
    """Badges list from a catalog/manifest entry ([] when absent — Feature 2)."""
    raw = entry.get("badges")
    if not isinstance(raw, list):
        return []
    return [str(b) for b in raw]


def _rich_metadata(entry: dict[str, Any]) -> dict[str, Any]:
    """Rich marketplace metadata (stitch.plugin/v2) from a feed entry.

    Every key is always present in the returned dict; entries lacking a
    field (community/old rows) emit None so the shape is stable for the UI.
    """
    return {
        "description_i18n": entry.get("description_i18n"),
        "category": entry.get("category"),
        "status": entry.get("status"),
        "icon": entry.get("icon"),
        "features": entry.get("features"),
        "changelog": entry.get("changelog"),
        "homepage": entry.get("homepage"),
        "repository": entry.get("repository"),
    }


def _dev_mode_on() -> bool:
    """True when STITCH_DEV_MODE is set (same semantics as plugin discovery)."""
    import os

    return os.environ.get("STITCH_DEV_MODE", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _local_service_manifests() -> list[dict[str, Any]]:
    """Dev-installed service plugins in plugins-local, with manifest metadata.

    Resolves ``.stitch-link`` pointer dirs (dev-install --link).  Only
    consulted in dev mode — production installs never carry unsigned local
    packages, and discovery rejects them there anyway.
    """
    import json

    root = plugins_local_dir()
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        entry = resolve_link(entry)
        manifest_path = entry / "plugin.json"
        if not manifest_path.is_file():
            continue
        try:
            manifest = validate_manifest(
                json.loads(manifest_path.read_text(encoding="utf-8"))
            )
        except Exception:  # noqa: BLE001 — a broken local package must not break the marketplace
            continue
        if manifest.kind != "service":
            continue
        extras = manifest.extras
        description = extras.get("description")
        rich = _rich_metadata(extras)
        rich["description_i18n"] = description if isinstance(description, dict) else None
        author = extras.get("author")
        out.append(
            {
                "id": manifest.id,
                "name": manifest.name,
                "version": manifest.version,
                "author": author if isinstance(author, str) else None,
                "description": resolve_i18n(description) or None,
                "rich": rich,
            }
        )
    return out


def _is_community_approved(entry: dict[str, Any]) -> bool:
    """True for server-catalog entries merged from approved submissions.

    They carry ``source_kind == 'community_approved'`` and/or a release
    ``source`` pointing at the server's Bearer-gated ``/community-pkg/``.
    """
    if entry.get("source_kind") == "community_approved":
        return True
    src = entry.get("source")
    return (
        isinstance(src, dict)
        and src.get("type") == "release"
        and "/community-pkg/" in str(src.get("url", ""))
    )


def _community_item(
    entry: dict[str, Any], installed_community: dict[tuple[str, str], dict]
) -> dict[str, Any] | None:
    """Build a marketplace item from a server ``/catalog`` community entry.

    Returns ``None`` when the entry is not community-approved or malformed.
    Approved community plugins are NOT in ``/manifest`` (unsigned, served via
    ``/community-pkg``), so both the activated and unactivated marketplace
    paths merge them from the public ``/catalog`` feed through this helper.
    """
    if not isinstance(entry, dict) or not _is_community_approved(entry):
        return None
    plugin_id = str(entry.get("id", ""))
    version = str(entry.get("version", ""))
    if not plugin_id or not version:
        return None
    is_installed = (plugin_id, version) in installed_community
    return {
        "id": plugin_id,
        "name": str(entry.get("name") or plugin_id),
        "description": entry.get("description"),
        "author": entry.get("author"),
        "version": version,
        "source": "community",
        "entitled": True,
        "installed": is_installed,
        "installed_version": version if is_installed else None,
        "can_download": True,
        "required_tier": None,
        "badges": _badges_of(entry),
        **_rich_metadata(entry),
    }


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
    async with httpx.AsyncClient(timeout=5.0, verify=shared_ssl_context()) as client:
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
    async with httpx.AsyncClient(timeout=5.0, verify=shared_ssl_context()) as client:
        sync = PluginSyncService(activation, client=client)
        catalog = await sync.fetch_public_catalog()
    _cache_set("catalog_public", catalog)
    return catalog


@register_command("get_marketplace", readonly=True)
async def cmd_get_marketplace(params: dict) -> dict:
    """Merge official + community + installed state into one list.

    Returns ``{"activated": bool, "items": [...], "feeds": {...}}``.
    Never raises — server/catalog failures degrade to empty lists, with the
    per-feed status surfaced in ``feeds`` so the UI can show an honest
    "server unavailable" state instead of a fake "no matches" one.

    Entitlement dual-path:
      - Auth enabled (caller context) → ``get_effective_entitlements``.
      - Desktop / no-auth → legacy ``state.entitlements`` from ``.activation``.
    Community items are always entitled (unchanged).
    """
    items: list[dict[str, Any]] = []
    # Feed health for the UI: "ok" fetched, "error" upstream failed,
    # "skipped" not attempted (activated-but-degraded activation).
    official_feed = "skipped"
    community_feed = "ok"

    activation = ActivationService()
    state = activation.load()
    activated = state is not None

    # Local community installs (id, version) — consulted by every loop for
    # community-source items, including server-approved ones (Feature 2).
    installed_community = {
        (p["id"], p["version"]): p for p in list_installed_community()
    }

    # Dual-path entitlement resolution.
    use_grants = _caller_uses_grants(params)
    if use_grants:
        caller_user_id = params.get("_caller_user_id")
        caller_role = params.get("_caller_role")
        grant_entitlements = await get_effective_entitlements(
            caller_user_id, caller_role
        )

    # Fetch upstream feeds concurrently (cached, short timeout) so a slow
    # upstream degrades fast instead of blocking the marketplace page.
    # ``catalog_task`` = GitHub community catalog; ``server_catalog_task`` =
    # the distribution server's public /catalog (official metadata + Feature-2
    # community_approved entries carrying badges + a /community-pkg source).
    catalog_task = asyncio.create_task(_fetch_catalog_cached())
    server_catalog_task = asyncio.create_task(_fetch_public_catalog_cached(activation))

    # ── Official plugins ──────────────────────────────────────────────────
    if state is not None and not state.degraded:
        try:
            manifest = await _fetch_manifest_cached(activation, state.token)
            official_feed = "ok"
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
                # community_approved entries are merged from the server
                # /catalog below — they are not in the signed /manifest.
                if _is_community_approved(entry):
                    continue
                entitled = (
                    is_entitled_to(plugin_id, grant_entitlements)
                    if use_grants
                    else _is_entitled(plugin_id, state.entitlements)
                )
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
                        "badges": _badges_of(entry),
                        **_rich_metadata(entry),
                    }
                )
        except Exception as exc:  # noqa: BLE001 — marketplace must not crash
            logger.warning("Marketplace: official manifest fetch failed: %s", exc)
            official_feed = "error"
            activated = False
    elif state is None:
        # No activation: official plugins stay VISIBLE but locked — the
        # marketplace is the funnel; downloads require activation.
        try:
            public_catalog = await server_catalog_task
            official_feed = "ok"
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
                if _is_community_approved(entry):
                    continue  # merged from the server /catalog below
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
                        "badges": _badges_of(entry),
                        **_rich_metadata(entry),
                    }
                )
        except Exception as exc:  # noqa: BLE001 — marketplace must not crash
            logger.warning("Marketplace: public catalog fetch failed: %s", exc)
            official_feed = "error"

    # ── Feature 2: server-approved community plugins ──────────────────────
    # Approved submissions live only in the server /catalog (unsigned, served
    # via the Bearer-gated /community-pkg). Merge them for BOTH activated and
    # unactivated callers; the download itself still requires a token (OC5).
    try:
        server_catalog = await server_catalog_task
        for entry in server_catalog.get("plugins", []):
            item = _community_item(entry, installed_community)
            if item is not None:
                items.append(item)
    except Exception as exc:  # noqa: BLE001 — marketplace must not crash
        logger.warning("Marketplace: server community merge failed: %s", exc)

    try:
        catalog = await catalog_task
        if catalog.get("_fetch_error"):
            community_feed = "error"
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
                    "badges": _badges_of(entry),
                    **_rich_metadata(entry),
                }
            )
    except Exception as exc:  # noqa: BLE001 — marketplace must not crash
        logger.warning("Marketplace: community catalog fetch failed: %s", exc)
        community_feed = "error"

    # Dev installs (plugins-local) — merged last so they stay visible even
    # when every upstream feed is down.  Dev mode only: production never has
    # unsigned local packages (discovery rejects them).
    if _dev_mode_on():
        seen = {str(i.get("id", "")) for i in items}
        for local in _local_service_manifests():
            plugin_id = str(local["id"])
            version = str(local["version"])
            if plugin_id in seen:
                for i in items:
                    if i.get("id") == plugin_id:
                        i["installed"] = True
                        i["installed_version"] = version
                        # Feed rows predating the manifest fields shadow the on-disk dev manifest; backfill from it.
                        if i.get("description_i18n") is None:
                            i.update(local["rich"])
                        if not i.get("description"):
                            i["description"] = local["description"]
                        if not i.get("author"):
                            i["author"] = local["author"]
                continue
            items.append(
                {
                    "id": plugin_id,
                    "name": local["name"],
                    "description": local["description"],
                    "author": local["author"],
                    "version": version,
                    "source": "local",
                    "entitled": True,
                    "installed": True,
                    "installed_version": version,
                    "can_download": False,
                    "required_tier": None,
                    "badges": [],
                    **local["rich"],
                }
            )

    return {
        "activated": activated,
        "items": items,
        "feeds": {"official": official_feed, "community": community_feed},
    }


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
            logger.error(
                "HTTP %d downloading official plugin %s v%s from %s: %s",
                status,
                plugin_id,
                version,
                exc.request.url,
                exc.response.text[:500] if exc.response.text else "(no body)",
            )
            if status == 403:
                return {"success": False, "error": "server denied download (403)"}
            return {"success": False, "error": f"download failed ({status}): {exc}"}
        except Exception as exc:  # noqa: BLE001 — surface as command error
            logger.exception("Install failed for plugin %s v%s", plugin_id, version)
            return {"success": False, "error": f"install failed: {exc}"}

    return {"success": True, "error": None}


async def _install_community_latest(plugin_id: str) -> dict[str, Any]:
    """Install the latest community version from the catalog.

    Falls back to the distribution server's approved-community listing
    (Feature 2) when the id is not in the GitHub catalog; those entries
    install via ``sources.install_from_source`` release mode with the
    activation Bearer token attached to the ``/community-pkg/`` download.
    """
    catalog = fetch_catalog()
    versions = [
        str(e.get("version", ""))
        for e in catalog.get("plugins", [])
        if isinstance(e, dict) and str(e.get("id", "")) == plugin_id
    ]
    if not versions:
        return await install_server_community(plugin_id)
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
    if source == "local":
        return _uninstall_local(plugin_id)
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


def _uninstall_local(plugin_id: str) -> dict[str, Any]:
    """Remove a dev-installed package (copy or .stitch-link pointer dir)."""
    root = plugins_local_dir() / plugin_id
    if not root.is_dir():
        return {"success": False, "error": "not installed"}
    shutil.rmtree(root, ignore_errors=True)
    if root.is_dir():
        return {"success": False, "error": "failed to remove local plugin directory"}
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
