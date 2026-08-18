"""Community plugin commands — catalog browse, install/uninstall, author submit.

Wires the community channel (catalog + install/uninstall) to the command
registry.  The ``submit_for_review`` command implements the GitHub PR flow:
fork the catalog repo, push the 4 package files to a branch, open a PR.

Token is never logged or persisted — it is used only for the duration of
the request and dropped.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from autoreg.plugin.layout import plugins_local_dir
from autoreg.plugin.manifest import validate_manifest
from stitch_backend.core.command_registry import register_command

from .community import (
    fetch_catalog,
    install_community,
    list_installed_community,
    uninstall_community,
)
from .github_pr import submit_catalog_pr

logger = logging.getLogger(__name__)

_PACKAGE_FILES = ("plugin.json", "scenario.json", "selectors.json", "profile.json")


@register_command("get_community_catalog", readonly=True)
async def cmd_get_community_catalog(params: dict) -> dict:
    """Browse the community plugin catalog."""
    return {"plugins": fetch_catalog().get("plugins", [])}


@register_command("install_community_plugin")
async def cmd_install_community_plugin(params: dict) -> dict:
    """Install a community plugin by id + version."""
    plugin_id = str(params.get("id", ""))
    version = str(params.get("version", ""))
    if not plugin_id or not version:
        return {"success": False, "error": "id and version required"}
    return await install_community(plugin_id, version)


@register_command("uninstall_community_plugin")
async def cmd_uninstall_community_plugin(params: dict) -> dict:
    """Uninstall a previously installed community plugin."""
    plugin_id = str(params.get("id", ""))
    version = params.get("version")
    if not plugin_id:
        return {"success": False, "error": "id required"}
    ver = str(version) if version is not None else None
    return uninstall_community(plugin_id, ver)


@register_command("list_installed_community", readonly=True)
async def cmd_list_installed_community(params: dict) -> dict:
    """List community plugins currently installed locally."""
    return {"packages": list_installed_community()}


@register_command("list_local_packages", readonly=True)
async def cmd_list_local_packages(params: dict) -> dict:
    """Scan plugins-local for author dev packages."""
    root = plugins_local_dir()
    if not root.is_dir():
        return {"packages": []}
    out: list[dict[str, Any]] = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        manifest_path = entry / "plugin.json"
        if not manifest_path.is_file():
            continue
        try:
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest = validate_manifest(raw)
        except Exception:  # noqa: BLE001 — skip corrupt
            continue
        services = [manifest.service]
        for s in manifest.services:
            if s not in services:
                services.append(s)
        out.append(
            {
                "id": manifest.id,
                "name": manifest.name,
                "version": manifest.version,
                "services": services,
                "path": str(entry),
            }
        )
    return {"packages": out}


@register_command("submit_for_review")
async def cmd_submit_for_review(params: dict) -> dict:
    """Submit a local package for review via GitHub PR.

    Flow: GET /user → ensure fork → branch from catalog main → PUT 4 files
    → POST pulls.  Token is never logged or persisted.
    """
    package_id = str(params.get("package_id", ""))
    token = str(params.get("github_token", ""))
    if not package_id or not token:
        return {"success": False, "error": "package_id and github_token required"}

    pkg_dir = plugins_local_dir() / package_id
    if not pkg_dir.is_dir():
        return {"success": False, "error": f"local package not found: {package_id}"}

    manifest_path = pkg_dir / "plugin.json"
    if not manifest_path.is_file():
        return {"success": False, "error": "package missing plugin.json"}
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest = validate_manifest(raw)
    except Exception as exc:  # noqa: BLE001 — manifest parse
        return {"success": False, "error": f"manifest invalid: {exc}"}

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    branch = f"submit/{manifest.id}-{manifest.version}"
    rel_path = f"plugins/{manifest.id}/{manifest.version}"
    files = []
    for fname in _PACKAGE_FILES:
        fpath = pkg_dir / fname
        if not fpath.is_file():
            continue
        files.append((f"{rel_path}/{fname}", fpath.read_bytes()))

    pr_body = f"Submitting plugin `{manifest.id}` v{manifest.version} for review."

    try:
        async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
            return await submit_catalog_pr(
                client,
                files=files,
                branch=branch,
                pr_title=f"plugin: {manifest.id}@{manifest.version}",
                pr_body=pr_body,
            )
    except httpx.HTTPError as exc:
        return {"success": False, "error": f"github api error: {exc}"}
