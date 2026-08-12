"""Community plugin commands — catalog browse, install/uninstall, author submit.

Wires the community channel (catalog + install/uninstall) to the command
registry.  The ``submit_for_review`` command implements the GitHub PR flow:
fork the catalog repo, push the 4 package files to a branch, open a PR.

Token is never logged or persisted — it is used only for the duration of
the request and dropped.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import TYPE_CHECKING, Any

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

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

_GH_API = "https://api.github.com"
_CATALOG_OWNER = "WhiteBite"
_CATALOG_REPO = "stitch-plugin-catalog"
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

    try:
        async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
            return await _submit_pr_flow(client, pkg_dir, manifest.id, manifest.version)
    except httpx.HTTPError as exc:
        return {"success": False, "error": f"github api error: {exc}"}


async def _submit_pr_flow(
    client: httpx.AsyncClient,
    pkg_dir: Path,
    plugin_id: str,
    version: str,
) -> dict[str, Any]:
    """Run the full GitHub PR submission flow.  Token is in client headers."""
    # 1. GET /user → login
    resp = await client.get(f"{_GH_API}/user")
    if resp.status_code != 200:
        return {"success": False, "error": f"invalid token (status {resp.status_code})"}
    login = resp.json().get("login", "")
    if not login:
        return {"success": False, "error": "could not determine github user"}

    # 2. Ensure fork exists
    fork_resp = await client.get(f"{_GH_API}/repos/{login}/{_CATALOG_REPO}")
    if fork_resp.status_code == 404:
        create = await client.post(
            f"{_GH_API}/repos/{_CATALOG_OWNER}/{_CATALOG_REPO}/forks"
        )
        if create.status_code not in (200, 202):
            return {"success": False, "error": f"fork failed (status {create.status_code})"}
    elif fork_resp.status_code != 200:
        return {"success": False, "error": f"fork check failed (status {fork_resp.status_code})"}

    # 3. Get catalog main head + create branch
    refs = await client.get(
        f"{_GH_API}/repos/{login}/{_CATALOG_REPO}/git/refs/heads/main"
    )
    if refs.status_code != 200:
        return {"success": False, "error": f"catalog main head fetch failed (status {refs.status_code})"}
    main_sha = refs.json().get("object", {}).get("sha", "")
    if not main_sha:
        return {"success": False, "error": "catalog main head sha missing"}

    branch = f"submit/{plugin_id}-{version}"
    create_branch = await client.post(
        f"{_GH_API}/repos/{login}/{_CATALOG_REPO}/git/refs",
        json={"ref": f"refs/heads/{branch}", "sha": main_sha},
    )
    if create_branch.status_code not in (200, 201, 422):
        return {"success": False, "error": f"branch create failed (status {create_branch.status_code})"}

    # 4. PUT the 4 package files
    rel_path = f"plugins/{plugin_id}/{version}"
    for fname in _PACKAGE_FILES:
        fpath = pkg_dir / fname
        if not fpath.is_file():
            continue
        content = base64.b64encode(fpath.read_bytes()).decode("ascii")
        put = await client.put(
            f"{_GH_API}/repos/{login}/{_CATALOG_REPO}/contents/{rel_path}/{fname}",
            json={"message": f"add {plugin_id}@{version}: {fname}", "content": content, "branch": branch},
        )
        if put.status_code not in (200, 201):
            return {"success": False, "error": f"upload {fname} failed (status {put.status_code})"}

    # 5. Open PR
    pr = await client.post(
        f"{_GH_API}/repos/{_CATALOG_OWNER}/{_CATALOG_REPO}/pulls",
        json={
            "title": f"plugin: {plugin_id}@{version}",
            "head": f"{login}:{branch}",
            "base": "main",
            "body": f"Submitting plugin `{plugin_id}` v{version} for review.",
        },
    )
    if pr.status_code not in (200, 201):
        return {"success": False, "error": f"pr create failed (status {pr.status_code})"}
    pr_url = pr.json().get("html_url", "")
    if not pr_url:
        return {"success": False, "error": "pr created but url missing"}
    return {"success": True, "pr_url": pr_url}
