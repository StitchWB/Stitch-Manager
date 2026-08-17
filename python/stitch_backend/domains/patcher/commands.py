"""Patcher domain commands.

Handles IDE detection, patch management, and backup operations.
All filesystem operations are async via asyncio.to_thread() to avoid blocking the event loop.
Read operations are cached with TTL to improve performance.
"""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.ttl_cache import TTLCache, TTLCacheDict
from stitch_backend.domains.patcher.detector import detect_all_ides, detect_ide, get_config_dir

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────

INJECTION_MARKER = "// STITCH_PATCH_INJECTED"
PATCH_BACKUP_DIR_NAME = "stitch_backups"

# Caches for expensive operations
_detect_cache = TTLCache(ttl_seconds=120.0)  # Increased from 60s to 120s
_patch_status_cache = TTLCacheDict(ttl_seconds=60.0)
_backups_cache = TTLCacheDict(ttl_seconds=30.0)
_config_cache = TTLCache(ttl_seconds=60.0)
_config_cache = TTLCache(ttl_seconds=60.0)

# IDE → extension file name to patch (relative to the extension folder)
_IDE_EXTENSION_FILES: dict[str, list[str]] = {
    "kiro": [
        "resources/app/extensions/kiro.kiro-agent/dist/extension.js",
        "dist/extension.js",
    ],
    "windsurf": ["dist/extension.js"],
    "trae": ["dist/extension.js"],
    "cursor": ["dist/extension.js"],
}


# ── Cache Invalidation ────────────────────────────────────────────────────

def _invalidate_all_caches() -> None:
    """Invalidate all caches after mutation operations."""
    _detect_cache.invalidate()
    _patch_status_cache.invalidate()
    _backups_cache.invalidate()
    _config_cache.invalidate()


def _invalidate_ide_cache(ide_type: str) -> None:
    """Invalidate caches for a specific IDE after mutation."""
    _detect_cache.invalidate()
    _patch_status_cache.invalidate(ide_type)
    _backups_cache.invalidate(ide_type)


# ── Helpers ────────────────────────────────────────────────────────────────

def _get_backup_dir(ide: str) -> Path:
    """Return the backup directory for a given IDE.

    Caches the result to avoid repeated mkdir() calls.
    """
    if not hasattr(_get_backup_dir, '_cache'):
        cast("Any", _get_backup_dir)._cache = {}

    if ide not in cast("Any", _get_backup_dir)._cache:
        config_dir = get_config_dir(ide)
        if config_dir is None:
            config_dir = Path.home() / f".{ide}"
        backup_dir = config_dir / PATCH_BACKUP_DIR_NAME
        backup_dir.mkdir(parents=True, exist_ok=True)
        cast("Any", _get_backup_dir)._cache[ide] = backup_dir

    return cast("Path", cast("Any", _get_backup_dir)._cache[ide])


def _find_extension_path(ide: str) -> Path | None:
    """Locate the main extension file for an IDE."""
    installation = detect_ide(ide)
    if installation is None:
        return None

    candidates = _IDE_EXTENSION_FILES.get(ide, ["dist/extension.js"])
    for rel in candidates:
        candidate = cast("Path", installation.install_path) / rel
        if candidate.exists():
            return candidate
    return None


def _read_patch_version(file_path: Path) -> str | None:
    """Extract patch version marker from a patched file.

    Only the head of the file is read: patch markers are injected at the very
    top (right after ``"use strict";``), and extension bundles can be tens of
    megabytes — reading the whole file made detect_ides take ~10 seconds.
    """
    try:
        with open(file_path, encoding="utf-8", errors="replace") as f:
            content = f.read(8192)
    except OSError:
        return None

    # Check all version markers
    if "/* STITCH_PATCHED - V3 WITH CONFIGURATION */" in content:
        return "V3"
    if "/* STITCH_PATCHED - V2 */" in content:
        return "V2"
    if "/* STITCH_PATCHED - V1 */" in content:
        return "V1"
    if INJECTION_MARKER in content:
        # Try to extract version from marker comment
        match = re.search(r"STITCH_PATCH_INJECTED\s+v(\S+)", content)
        return f"v{match.group(1)}" if match else "unknown"
    return None


#: Guards the process-list cache. detect_ides scans several IDEs in a thread
#: pool; without a lock every worker ran psutil.process_iter() simultaneously
#: (thundering herd), each full process scan taking seconds on Windows.
_process_scan_lock = threading.Lock()


def _get_running_processes() -> set[str]:
    """Get set of running process names (cached for 30 seconds)."""
    if not hasattr(_get_running_processes, '_cache'):
        cast("Any", _get_running_processes)._cache = None
        cast("Any", _get_running_processes)._cache_time = 0

    current_time = time.time()
    cache = cast("Any", _get_running_processes)._cache
    cache_time = cast("Any", _get_running_processes)._cache_time
    if cache is not None and current_time - cache_time <= 30:
        return cast("set[str]", cache)

    # Re-check under the lock so only one thread pays for the psutil scan.
    with _process_scan_lock:
        cache = cast("Any", _get_running_processes)._cache
        cache_time = cast("Any", _get_running_processes)._cache_time
        current_time = time.time()
        if cache is not None and current_time - cache_time <= 30:
            return cast("set[str]", cache)
        try:
            import psutil
            cache = {
                proc.info["name"].lower()
                for proc in psutil.process_iter(["name"])
                if proc.info["name"]
            }
        except Exception:
            cache = set()
        cast("Any", _get_running_processes)._cache = cache
        cast("Any", _get_running_processes)._cache_time = current_time

    return cast("set[str]", cache)


def _is_ide_running(ide: str) -> bool:
    """Check if an IDE process is currently running."""
    process_names: dict[str, list[str]] = {
        "kiro": ["kiro"],
        "windsurf": ["windsurf", "Windsurf"],
        "cursor": ["cursor", "Cursor"],
        "trae": ["trae", "Trae"],
    }

    names = process_names.get(ide, [ide])
    running_processes = _get_running_processes()

    return any(
        any(name.lower() in proc_name for name in names)
        for proc_name in running_processes
    )


# ── Synchronous Operations (run in threads) ───────────────────────────────

def _scan_single_ide(inst) -> dict[str, Any]:
    """Scan a single IDE installation (runs in thread pool)."""
    installed = inst.install_path is not None and inst.install_path.exists()
    ext_path = _find_extension_path(inst.ide_id) if installed else None
    patch_version = _read_patch_version(ext_path) if ext_path else None

    return {
        "id": inst.ide_id,
        "name": inst.name,
        "type": inst.ide_id,
        "displayName": inst.display_name,
        "version": inst.version,
        "path": str(inst.install_path) if installed else None,
        "installPath": str(inst.install_path) if installed else None,
        "extensionPath": str(ext_path) if ext_path else None,
        "patchVersion": patch_version,
        "isPatched": patch_version is not None,
        "isRunning": _is_ide_running(inst.ide_id) if installed else False,
        "canPatch": ext_path is not None and patch_version is None,
        "installed": installed,
    }


def _sync_detect_all() -> list[dict[str, Any]]:
    """Synchronous IDE detection with parallel scanning (runs in thread)."""
    installations = detect_all_ides()

    # Scan all IDEs in parallel using thread pool
    with ThreadPoolExecutor(max_workers=min(len(installations), 4)) as executor:
        # Submit all scan tasks
        future_to_inst = {
            executor.submit(_scan_single_ide, inst): inst
            for inst in installations
        }

        # Collect results as they complete
        result = []
        for future in as_completed(future_to_inst):
            try:
                result.append(future.result())
            except Exception as e:
                inst = future_to_inst[future]
                logger.error(f"Failed to scan IDE {inst.ide_id}: {e}")
                # Add error entry
                result.append({
                    "id": inst.ide_id,
                    "name": inst.name,
                    "type": inst.ide_id,
                    "displayName": inst.display_name,
                    "version": None,
                    "path": None,
                    "installPath": None,
                    "extensionPath": None,
                    "patchVersion": None,
                    "isPatched": False,
                    "isRunning": False,
                    "canPatch": False,
                    "installed": False,
                    "error": str(e),
                })

    return result


def _sync_get_patch_status(ide_type: str) -> dict[str, Any]:
    """Synchronous patch status check (runs in thread)."""
    inst = detect_ide(ide_type)
    if not inst:
        return {"ideType": ide_type, "status": "not_installed", "patchVersion": None}

    ext_path = _find_extension_path(ide_type)
    if not ext_path:
        return {"ideType": ide_type, "status": "no_extension", "patchVersion": None}

    patch_version = _read_patch_version(ext_path)
    backup_dir = _get_backup_dir(ide_type)
    has_backup = any(backup_dir.glob("*.bak"))

    return {
        "ideType": ide_type,
        "status": "patched" if patch_version else "not_patched",
        "patchVersion": patch_version,
        "extensionPath": str(ext_path),
        "hasBackup": has_backup,
    }


def _sync_list_backups(ide_type: str) -> list[dict[str, Any]]:
    """Synchronous backup listing (runs in thread)."""
    backup_dir = _get_backup_dir(ide_type)
    backups = []
    for backup_file in sorted(backup_dir.glob("*.bak"), reverse=True):
        stat = backup_file.stat()
        backups.append({
            "id": backup_file.name,
            "path": str(backup_file),
            "size": stat.st_size,
            "createdAt": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
        })
    return backups


def _sync_read_config() -> dict[str, Any]:
    """Synchronous config read (runs in thread)."""
    from stitch_backend.domains.kiro_patch.service import get_config
    return get_config()


def _sync_launch_ide(ide_id: str) -> dict[str, Any]:
    """Synchronous IDE launch (runs in thread)."""
    import platform
    import subprocess

    inst = detect_ide(ide_id)
    if not inst or not inst.install_path:
        return {"success": False, "error": f"IDE {ide_id} not found"}

    install_path = inst.install_path
    system = platform.system()

    try:
        if system == "Windows":
            # Windows: find executable in install path
            exe_candidates = {
                "kiro": ["Kiro.exe"],
                "cursor": ["Cursor.exe"],
                "windsurf": ["Windsurf.exe"],
                "trae": ["Trae.exe"],
            }

            candidates = exe_candidates.get(ide_id, [])
            exe_path = None

            for candidate in candidates:
                potential_path = install_path / candidate
                if potential_path.exists():
                    exe_path = potential_path
                    break

            if not exe_path:
                return {"success": False, "error": f"Executable not found for {ide_id}"}

            subprocess.Popen([str(exe_path)], cwd=str(install_path))
            return {"success": True, "message": f"Launched {ide_id}"}

        elif system == "Darwin":
            # macOS: use open command
            app_path = install_path
            if not str(app_path).endswith(".app"):
                app_path = install_path / f"{ide_id.capitalize()}.app"

            if not app_path.exists():
                return {"success": False, "error": f"App not found for {ide_id}"}

            subprocess.Popen(["open", str(app_path)])
            return {"success": True, "message": f"Launched {ide_id}"}

        else:
            # Linux: find executable
            exe_candidates = {
                "kiro": ["kiro"],
                "cursor": ["cursor"],
                "windsurf": ["windsurf"],
                "trae": ["trae"],
            }

            candidates = exe_candidates.get(ide_id, [ide_id])
            exe_path = None

            for candidate in candidates:
                potential_path = install_path / candidate
                if potential_path.exists():
                    exe_path = potential_path
                    break

            if not exe_path:
                return {"success": False, "error": f"Executable not found for {ide_id}"}

            subprocess.Popen([str(exe_path)], cwd=str(install_path))
            return {"success": True, "message": f"Launched {ide_id}"}

    except Exception as e:
        return {"success": False, "error": f"Failed to launch {ide_id}: {str(e)}"}


def _sync_apply_patch(ide_type: str, create_backup: bool) -> dict[str, Any]:
    """Synchronous patch application (runs in thread)."""
    from stitch_backend.domains.kiro_patch.service import apply_patch_with_config, get_config
    try:
        # Create backup before patching if requested
        backup_path = None
        if create_backup:
            inst = detect_ide(ide_type)
            if inst and inst.install_path:
                ext_path = _find_extension_path(ide_type)
                if ext_path and ext_path.exists():
                    backup_dir = _get_backup_dir(ide_type)
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    backup_filename = f"{ide_type}_extension_{timestamp}.bak"
                    backup_path = backup_dir / backup_filename
                    shutil.copy2(ext_path, backup_path)
                    logger.info("Created backup: %s", backup_path)

        config = get_config()
        result = apply_patch_with_config(config)

        # Invalidate backups cache since we may have created a new backup
        if backup_path:
            _backups_cache.invalidate(ide_type)

        return {
            "success": True,
            "message": result,
            "backupPath": str(backup_path) if backup_path else None
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def _sync_remove_patch(ide_type: str, restore_backup: bool) -> dict[str, Any]:
    """Synchronous patch removal (runs in thread)."""
    from stitch_backend.domains.kiro_patch.service import remove_patch
    try:
        result = remove_patch()
        return {"success": True, "message": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _sync_restore_backup(backup_id: str) -> dict[str, Any]:
    """Synchronous backup restoration (runs in thread)."""
    try:
        # Parse backup_id to extract IDE type
        # Format: {ide_type}_extension_{timestamp}.bak
        parts = backup_id.split('_extension_')
        if len(parts) != 2:
            return {"success": False, "error": f"Invalid backup ID format: {backup_id}"}

        ide_type = parts[0]

        # Find the IDE installation
        inst = detect_ide(ide_type)
        if not inst or not inst.install_path:
            return {"success": False, "error": f"IDE {ide_type} not found"}

        # Find extension file
        ext_path = _find_extension_path(ide_type)
        if not ext_path:
            return {"success": False, "error": f"Extension file not found for {ide_type}"}

        # Find backup file
        backup_dir = _get_backup_dir(ide_type)
        backup_path = backup_dir / backup_id

        if not backup_path.exists():
            return {"success": False, "error": f"Backup file not found: {backup_id}"}

        # Restore backup
        shutil.copy2(backup_path, ext_path)
        logger.info("Restored %s from backup %s", ext_path, backup_id)

        # Invalidate caches
        _invalidate_ide_cache(ide_type)

        return {
            "success": True,
            "message": f"Restored {ide_type} from backup {backup_id}",
            "backupPath": str(backup_path),
        }
    except Exception as e:
        logger.error("Failed to restore backup: %s", e)
        return {"success": False, "error": str(e)}


# ── Commands ──────────────────────────────────────────────────────────────

@register_command("detect_ides")
async def cmd_detect_ides(params: dict) -> list[dict[str, Any]]:
    """Detect all installed IDEs and their patch status.

    Args:
        force: If True, bypass cache and rescan (default: False)
    """
    force = params.get("force", False)

    if not force:
        cached = _detect_cache.get()
        if cached is not None:
            return cast("list[dict[str, Any]]", cached)

    result = await asyncio.to_thread(_sync_detect_all)
    _detect_cache.set(result)
    return result


@register_command("get_patch_status")
async def cmd_get_patch_status(params: dict) -> dict[str, Any]:
    """Get patch status for a specific IDE."""
    ide_type = params.get("ideType", "")
    if not ide_type:
        return {"error": "ideType required"}

    cached = _patch_status_cache.get(ide_type)
    if cached is not None:
        return cast("dict[str, Any]", cached)

    result = await asyncio.to_thread(_sync_get_patch_status, ide_type)
    _patch_status_cache.set(ide_type, result)
    return result


@register_command("list_backups")
async def cmd_list_backups(params: dict) -> list[dict[str, Any]]:
    """List all backups for an IDE."""
    ide_type = params.get("ideType", "")
    if not ide_type:
        return []

    cached = _backups_cache.get(ide_type)
    if cached is not None:
        return cast("list[dict[str, Any]]", cached)

    result = await asyncio.to_thread(_sync_list_backups, ide_type)
    _backups_cache.set(ide_type, result)
    return result


@register_command("get_kiro_patch_config")
async def cmd_get_kiro_patch_config(params: dict) -> dict[str, Any]:
    """Get Kiro patch configuration."""
    cached = _config_cache.get()
    if cached is not None:
        return cast("dict[str, Any]", cached)

    result = await asyncio.to_thread(_sync_read_config)
    _config_cache.set(result)
    return result


@register_command("apply_patch")
async def cmd_apply_patch(params: dict) -> dict[str, Any]:
    """Apply patch to an IDE."""
    ide_type = params.get("ideType", "")
    create_backup = params.get("createBackup", True)

    if not ide_type:
        return {"success": False, "error": "ideType required"}

    result = await asyncio.to_thread(_sync_apply_patch, ide_type, create_backup)
    if result.get("success"):
        _invalidate_ide_cache(ide_type)
    return result


@register_command("remove_patch")
async def cmd_remove_patch(params: dict) -> dict[str, Any]:
    """Remove patch from an IDE."""
    ide_type = params.get("ideType", "")
    restore_backup = params.get("restoreBackup", False)

    if not ide_type:
        return {"success": False, "error": "ideType required"}

    result = await asyncio.to_thread(_sync_remove_patch, ide_type, restore_backup)
    if result.get("success"):
        _invalidate_ide_cache(ide_type)
    return result


@register_command("restore_backup")
async def cmd_restore_backup(params: dict) -> dict[str, Any]:
    """Restore a backup."""
    backup_id = params.get("backupId", "")

    if not backup_id:
        return {"success": False, "error": "backupId required"}

    result = await asyncio.to_thread(_sync_restore_backup, backup_id)
    if result.get("success"):
        _invalidate_all_caches()
    return result


@register_command("launch_ide")
async def cmd_launch_ide(params: dict) -> dict[str, Any]:
    """Launch an IDE."""
    ide_id = params.get("ideId", "")

    if not ide_id:
        return {"success": False, "error": "ideId required"}

    result = await asyncio.to_thread(_sync_launch_ide, ide_id)
    return result
