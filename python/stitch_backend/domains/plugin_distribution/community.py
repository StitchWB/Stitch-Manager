"""Community plugin channel — catalog client + install/uninstall (plan §3.5).

Community plugins are unsigned (trust=community) packages contributed via
GitHub PR to ``WhiteBite/stitch-plugin-catalog``.  Catalog is a JSON index
at the repo root; packages live under ``plugins/<id>/<version>/`` and are
downloaded as a whole-repo zip from codeload.github.com.

This module NEVER raises — catalog failures degrade to an empty plugin
list with a warning, install failures return ``{"success": False, "error"}``.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import shutil
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any

import httpx

from autoreg.plugin.manifest import validate_manifest

from .config import data_dir

logger = logging.getLogger(__name__)

_DEFAULT_CATALOG_URL = (
    "https://raw.githubusercontent.com/WhiteBite/stitch-plugin-catalog/main/catalog.json"
)
_REPO_ZIP_URL = (
    "https://codeload.github.com/WhiteBite/stitch-plugin-catalog/zip/refs/heads/main"
)
_CACHE_TTL_SECONDS = 60.0

_catalog_cache: dict[str, Any] | None = None
_catalog_cache_ts: float = 0.0


def _catalog_url() -> str:
    return os.environ.get("STITCH_COMMUNITY_CATALOG_URL", _DEFAULT_CATALOG_URL)


def _community_root() -> Path:
    return data_dir() / "community"


def _package_dir(plugin_id: str, version: str) -> Path:
    return _community_root() / plugin_id / version


def _invalidate_cache() -> None:
    """Test hook — drop the in-memory catalog cache."""
    global _catalog_cache, _catalog_cache_ts
    _catalog_cache = None
    _catalog_cache_ts = 0.0


# ── Catalog fetch ────────────────────────────────────────────────────────────


def fetch_catalog() -> dict[str, Any]:
    """Return the community catalog dict (sync, 60s in-memory cache).

    Network/parse failure → ``{"plugins": []}`` + warning; never raises.
    """
    global _catalog_cache, _catalog_cache_ts
    now = time.monotonic()
    if _catalog_cache is not None and (now - _catalog_cache_ts) < _CACHE_TTL_SECONDS:
        return _catalog_cache

    try:
        with httpx.Client(timeout=15.0) as c:
            resp = c.get(_catalog_url())
            if resp.status_code != 200:
                logger.warning("Community catalog non-200 status %d", resp.status_code)
                result: dict[str, Any] = {"plugins": []}
            else:
                try:
                    body = resp.json()
                except ValueError as exc:
                    logger.warning("Community catalog JSON parse error: %s", exc)
                    body = {"plugins": []}
                if not isinstance(body, dict) or not isinstance(body.get("plugins"), list):
                    logger.warning("Community catalog malformed shape")
                    body = {"plugins": []}
                result = body
    except httpx.HTTPError as exc:
        logger.warning("Community catalog network error: %s", exc)
        result = {"plugins": []}

    _catalog_cache = result
    _catalog_cache_ts = now
    return result


# ── sha256 (same algorithm as catalog scripts/update_index.py) ──────────────


def _package_sha256(pkg_dir: Path) -> str:
    """sha256 of sorted ``relpath:sha256(file)`` lines over the package dir."""
    lines: list[str] = []
    for file in sorted(pkg_dir.rglob("*")):
        if not file.is_file():
            continue
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        lines.append(f"{file.relative_to(pkg_dir).as_posix()}:{digest}")
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()


# ── Install / uninstall ──────────────────────────────────────────────────────


async def install_community(
    plugin_id: str,
    version: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Download + verify + atomically install a community plugin.

    Returns ``{"success": bool, "error"?: str}``; never raises.
    """
    entry = _find_catalog_entry(fetch_catalog(), plugin_id, version)
    if entry is None:
        return {"success": False, "error": f"not in catalog: {plugin_id}@{version}"}

    expected_sha = entry.get("sha256", "")
    rel_path = entry.get("path", "")
    if not expected_sha or not rel_path:
        return {"success": False, "error": "catalog entry missing sha256/path"}

    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=30.0)
    try:
        try:
            resp = await client.get(_REPO_ZIP_URL)  # type: ignore[union-attr]
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            return {"success": False, "error": f"download failed: {exc}"}

        tmp_dir = Path(tempfile.mkdtemp(prefix="stitch-community-"))
        try:
            try:
                with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
                    zf.extractall(tmp_dir)
            except (zipfile.BadZipFile, OSError) as exc:
                return {"success": False, "error": f"zip extract failed: {exc}"}

            top = _find_repo_root(tmp_dir)
            if top is None:
                return {"success": False, "error": "zip missing top-level dir"}
            src_pkg = top / rel_path
            if not src_pkg.is_dir():
                return {"success": False, "error": f"package path not in zip: {rel_path}"}

            manifest_path = src_pkg / "plugin.json"
            if not manifest_path.is_file():
                return {"success": False, "error": "package missing plugin.json"}
            try:
                raw = json.loads(manifest_path.read_text(encoding="utf-8"))
                validate_manifest(raw)
            except Exception as exc:  # noqa: BLE001 — manifest parse
                return {"success": False, "error": f"manifest invalid: {exc}"}

            actual_sha = _package_sha256(src_pkg)
            if actual_sha != expected_sha:
                return {
                    "success": False,
                    "error": f"sha256 mismatch: expected {expected_sha}, got {actual_sha}",
                }

            target = _package_dir(plugin_id, version)
            target.parent.mkdir(parents=True, exist_ok=True)
            staging = target.parent / f".{version}.tmp.{os.getpid()}"
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)
            shutil.copytree(src_pkg, staging)
            try:
                _atomic_replace_dir(staging, target)
            except OSError as exc:
                return {"success": False, "error": f"install rename failed: {exc}"}
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)
    finally:
        if own_client and client is not None:
            await client.aclose()

    logger.info("Community plugin installed: %s@%s", plugin_id, version)
    return {"success": True}


def _find_catalog_entry(
    catalog: dict[str, Any], plugin_id: str, version: str
) -> dict[str, Any] | None:
    for entry in catalog.get("plugins", []):
        if not isinstance(entry, dict):
            continue
        if entry.get("id") == plugin_id and entry.get("version") == version:
            return entry
    return None


def _find_repo_root(extract_dir: Path) -> Path | None:
    entries = [p for p in extract_dir.iterdir() if p.is_dir()]
    return entries[0] if len(entries) == 1 else None


def _atomic_replace_dir(src: Path, dst: Path) -> None:
    if dst.exists():
        old = dst.parent / f"{dst.name}.old.{os.getpid()}"
        if old.exists():
            shutil.rmtree(old, ignore_errors=True)
        os.rename(dst, old)
        try:
            os.replace(src, dst)
        except OSError:
            os.rename(old, dst)
            raise
        shutil.rmtree(old, ignore_errors=True)
    else:
        os.replace(src, dst)


def uninstall_community(plugin_id: str, version: str | None = None) -> dict[str, Any]:
    """Remove a community plugin (one version, or all versions when None)."""
    root = _community_root() / plugin_id
    if not root.is_dir():
        return {"success": False, "error": "not installed"}
    if version is None:
        shutil.rmtree(root, ignore_errors=True)
        return {"success": True}
    target = root / version
    if not target.is_dir():
        return {"success": False, "error": f"version {version} not installed"}
    shutil.rmtree(target, ignore_errors=True)
    if root.is_dir() and not any(root.iterdir()):
        root.rmdir()
    return {"success": True}


def list_installed_community() -> list[dict[str, Any]]:
    """Return ``[{id, version, services, name}]`` for installed community plugins."""
    root = _community_root()
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for plugin_dir in sorted(root.iterdir()):
        if not plugin_dir.is_dir():
            continue
        for version_dir in sorted(plugin_dir.iterdir()):
            if not version_dir.is_dir():
                continue
            info = _read_package_info(version_dir)
            if info is not None:
                out.append(
                    {
                        "id": plugin_dir.name,
                        "version": version_dir.name,
                        "services": info["services"],
                        "name": info["name"],
                    }
                )
    return out


def _read_package_info(pkg_dir: Path) -> dict[str, Any] | None:
    manifest_path = pkg_dir / "plugin.json"
    if not manifest_path.is_file():
        return None
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest = validate_manifest(raw)
    except Exception:  # noqa: BLE001 — skip corrupt
        return None
    services = [manifest.service]
    for s in manifest.services:
        if s not in services:
            services.append(s)
    return {"services": services, "name": manifest.name}
