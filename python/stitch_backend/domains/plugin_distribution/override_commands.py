"""Local override commands — user-edited scenario overrides (plan §8 v1.1).

A local override is a user-edited ``scenario.json`` placed at
``<data_dir>/overrides/<plugin_id>/scenario.json``.  At run time the
executor hook in ``autoreg.plugin.provider_adapter`` prefers the override
over the resolved package's scenario when it parses successfully.

Commands:
    - ``list_overrides`` (readonly): union of installed packages (official
      cache + community + plugins-local) with override status.
    - ``create_override``: copy the currently resolved package's
      ``scenario.json`` into the overrides dir.
    - ``validate_override``: parse via ``autoreg.scenario.parse_v2``.
    - ``clear_override``: remove the override dir.
    - ``submit_override``: open a patch-candidate GitHub PR uploading the
      override scenario to ``patches/<plugin_id>@<version>/scenario.json``.

Token is never logged or persisted — same contract as
``community_commands.submit_for_review``.
"""

from __future__ import annotations

import json
import logging
import shutil
from typing import TYPE_CHECKING, Any

import httpx

from autoreg.plugin.layout import (
    _base_dir,
    plugins_cache_dir,
    plugins_local_dir,
)
from autoreg.plugin.manifest import validate_manifest
from autoreg.scenario.parse_v2 import ScenarioParseError, parse_scenario_v2
from stitch_backend.core.command_registry import register_command

from .community import _community_root
from .github_pr import submit_catalog_pr

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

_OVERRIDE_SUBDIR = "overrides"


def _overrides_dir() -> Path:
    """``<data_dir>/overrides`` — base dir for all local overrides."""
    return _base_dir() / _OVERRIDE_SUBDIR


def _override_path(plugin_id: str) -> Path:
    """Path to the override scenario for ``plugin_id``."""
    return _overrides_dir() / plugin_id / "scenario.json"


def _resolve_package_dir(plugin_id: str) -> Path | None:
    """Find the currently resolved package dir for ``plugin_id``.

    Mirrors the ``PluginLoader`` precedence (local → cache → community)
    but without signature verification — overrides are about the user's
    installed view, not the loader's trust gate.  Returns ``None`` when
    no package is installed for ``plugin_id``.
    """
    # 1. plugins-local/<id>/
    local = plugins_local_dir() / plugin_id
    if local.is_dir() and (local / "plugin.json").is_file():
        return local

    # 2. plugins/<id>/<version>/ — newest version wins
    cache_root = plugins_cache_dir() / plugin_id
    if cache_root.is_dir():
        candidates: list[tuple[tuple[int, int, int], Path]] = []
        for version_dir in cache_root.iterdir():
            if not version_dir.is_dir() or version_dir.name == ".staging":
                continue
            if not (version_dir / "plugin.json").is_file():
                continue
            try:
                raw = json.loads(
                    (version_dir / "plugin.json").read_text(encoding="utf-8")
                )
                manifest = validate_manifest(raw)
            except Exception:  # noqa: BLE001 — skip corrupt
                continue
            from autoreg.plugin.manifest import parse_semver

            try:
                candidates.append((parse_semver(manifest.version), version_dir))
            except ValueError:
                continue
        if candidates:
            candidates.sort(key=lambda c: c[0])
            return candidates[-1][1]

    # 3. community/<id>/<version>/ — newest version wins
    comm_root = _community_root() / plugin_id
    if comm_root.is_dir():
        candidates2: list[tuple[tuple[int, int, int], Path]] = []
        for version_dir in comm_root.iterdir():
            if not version_dir.is_dir() or version_dir.name.startswith("."):
                continue
            if not (version_dir / "plugin.json").is_file():
                continue
            try:
                raw = json.loads(
                    (version_dir / "plugin.json").read_text(encoding="utf-8")
                )
                manifest = validate_manifest(raw)
            except Exception:  # noqa: BLE001 — skip corrupt
                continue
            from autoreg.plugin.manifest import parse_semver

            try:
                candidates2.append((parse_semver(manifest.version), version_dir))
            except ValueError:
                continue
        if candidates2:
            candidates2.sort(key=lambda c: c[0])
            return candidates2[-1][1]

    return None


def _read_manifest_id(pkg_dir: Path) -> str | None:
    """Read the plugin id from a package's ``plugin.json``."""
    manifest_path = pkg_dir / "plugin.json"
    if not manifest_path.is_file():
        return None
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        return str(raw.get("id", ""))
    except Exception:  # noqa: BLE001 — skip corrupt
        return None


def _read_manifest_version(pkg_dir: Path) -> str | None:
    """Read the plugin version from a package's ``plugin.json``."""
    manifest_path = pkg_dir / "plugin.json"
    if not manifest_path.is_file():
        return None
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        return str(raw.get("version", ""))
    except Exception:  # noqa: BLE001 — skip corrupt
        return None


def _enumerate_installed_plugin_ids() -> list[str]:
    """Union of plugin ids across plugins-local, cache, and community."""
    ids: set[str] = set()

    local_root = plugins_local_dir()
    if local_root.is_dir():
        for entry in local_root.iterdir():
            if entry.is_dir() and (entry / "plugin.json").is_file():
                pid = _read_manifest_id(entry)
                if pid:
                    ids.add(pid)

    cache_root = plugins_cache_dir()
    if cache_root.is_dir():
        for entry in cache_root.iterdir():
            if not entry.is_dir() or entry.name == ".staging":
                continue
            for version_dir in entry.iterdir():
                if version_dir.is_dir() and (version_dir / "plugin.json").is_file():
                    pid = _read_manifest_id(version_dir)
                    if pid:
                        ids.add(pid)

    comm_root = _community_root()
    if comm_root.is_dir():
        for entry in comm_root.iterdir():
            if not entry.is_dir():
                continue
            for version_dir in entry.iterdir():
                if (
                    version_dir.is_dir()
                    and not version_dir.name.startswith(".")
                    and (version_dir / "plugin.json").is_file()
                ):
                    pid = _read_manifest_id(version_dir)
                    if pid:
                        ids.add(pid)

    return sorted(ids)


def _validate_override_file(path: Path) -> tuple[bool, str | None]:
    """Parse the override scenario at ``path``.

    Returns ``(valid, error)``.  ``error`` is ``None`` when valid.
    """
    if not path.is_file():
        return False, "override file not found"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        parse_scenario_v2(raw)
    except ScenarioParseError as exc:
        return False, str(exc)
    except (OSError, ValueError) as exc:
        return False, f"parse error: {exc}"
    return True, None


# ── Commands ─────────────────────────────────────────────────────────────────


@register_command("list_overrides", readonly=True)
async def cmd_list_overrides(params: dict) -> dict:
    """List override status for the union of installed packages.

    Returns ``{"overrides": [{"plugin_id", "has_override", "valid",
    "path", "error"?}]}``.
    """
    out: list[dict[str, Any]] = []
    for plugin_id in _enumerate_installed_plugin_ids():
        override_path = _override_path(plugin_id)
        has_override = override_path.is_file()
        entry: dict[str, Any] = {
            "plugin_id": plugin_id,
            "has_override": has_override,
            "valid": False,
            "path": str(override_path),
        }
        if has_override:
            valid, error = _validate_override_file(override_path)
            entry["valid"] = valid
            if error:
                entry["error"] = error
        out.append(entry)
    return {"overrides": out}


@register_command("create_override")
async def cmd_create_override(params: dict) -> dict:
    """Copy the currently resolved package's scenario.json into overrides.

    Fails if an override already exists.  Fails if no resolvable package.
    Returns ``{"success", "path"}``.
    """
    plugin_id = str(params.get("plugin_id", ""))
    if not plugin_id:
        return {"success": False, "error": "plugin_id required"}

    override_path = _override_path(plugin_id)
    if override_path.is_file():
        return {"success": False, "error": "override already exists"}

    pkg_dir = _resolve_package_dir(plugin_id)
    if pkg_dir is None:
        return {"success": False, "error": f"no resolvable package for: {plugin_id}"}

    scenario_path = pkg_dir / "scenario.json"
    if not scenario_path.is_file():
        return {"success": False, "error": "package missing scenario.json"}

    override_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(scenario_path, override_path)
    logger.info("Override created for %s at %s", plugin_id, override_path)
    return {"success": True, "path": str(override_path)}


@register_command("validate_override", readonly=True)
async def cmd_validate_override(params: dict) -> dict:
    """Parse the override scenario via ``autoreg.scenario.parse_v2``.

    Returns ``{"valid": bool, "error"?: str}``.
    """
    plugin_id = str(params.get("plugin_id", ""))
    if not plugin_id:
        return {"valid": False, "error": "plugin_id required"}

    override_path = _override_path(plugin_id)
    valid, error = _validate_override_file(override_path)
    result: dict[str, Any] = {"valid": valid}
    if error:
        result["error"] = error
    return result


@register_command("clear_override")
async def cmd_clear_override(params: dict) -> dict:
    """Remove the override dir for ``plugin_id``."""
    plugin_id = str(params.get("plugin_id", ""))
    if not plugin_id:
        return {"success": False, "error": "plugin_id required"}

    override_dir = _overrides_dir() / plugin_id
    if not override_dir.is_dir():
        return {"success": False, "error": "no override to remove"}
    shutil.rmtree(override_dir, ignore_errors=True)
    logger.info("Override cleared for %s", plugin_id)
    return {"success": True}


@register_command("submit_override")
async def cmd_submit_override(params: dict) -> dict:
    """Submit the override scenario as a patch-candidate PR.

    Uploads the override ``scenario.json`` to
    ``patches/<plugin_id>@<version>/scenario.json`` on a branch
    ``patch/<id>-<version>`` and opens a PR titled
    ``patch-candidate: <id>@<version>``.
    """
    plugin_id = str(params.get("plugin_id", ""))
    token = str(params.get("github_token", ""))
    if not plugin_id or not token:
        return {"success": False, "error": "plugin_id and github_token required"}

    override_path = _override_path(plugin_id)
    if not override_path.is_file():
        return {"success": False, "error": "no override to submit"}

    pkg_dir = _resolve_package_dir(plugin_id)
    if pkg_dir is None:
        return {"success": False, "error": f"no resolvable package for: {plugin_id}"}

    version = _read_manifest_version(pkg_dir) or "unknown"

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    branch = f"patch/{plugin_id}-{version}"
    rel_path = f"patches/{plugin_id}@{version}/scenario.json"
    files = [(rel_path, override_path.read_bytes())]

    pr_body = (
        f"Patch-candidate for plugin `{plugin_id}` v{version}.\n\n"
        "This scenario is a local override edited by the user and submitted "
        "as a candidate patch for review."
    )

    try:
        async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
            return await submit_catalog_pr(
                client,
                files=files,
                branch=branch,
                pr_title=f"patch-candidate: {plugin_id}@{version}",
                pr_body=pr_body,
            )
    except httpx.HTTPError as exc:
        return {"success": False, "error": f"github api error: {exc}"}
