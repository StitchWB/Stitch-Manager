"""Patcher domain command handlers.

Exposes IDE detection, patch application/removal, backup management,
and IDE status queries to the frontend.
"""

from __future__ import annotations

import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from stitch_backend.core.command_registry import register_command
from stitch_backend.domains.patcher.detector import (
    detect_all_ides,
    detect_ide,
    get_config_dir,
)
from stitch_backend.domains.patcher.verifier import file_checksum

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────

INJECTION_MARKER = "// STITCH_PATCH_INJECTED"
PATCH_BACKUP_DIR_NAME = "stitch_backups"

# IDE → extension file name to patch (relative to the extension folder)
_IDE_EXTENSION_FILES: dict[str, list[str]] = {
    "kiro": ["dist/extension.js"],
    "windsurf": ["dist/extension.js"],
    "trae": ["dist/extension.js"],
    "cursor": ["dist/extension.js"],
}


# ── Helpers ────────────────────────────────────────────────────────────────

def _get_backup_dir(ide: str) -> Path:
    """Return the backup directory for a given IDE."""
    config_dir = get_config_dir(ide)
    if config_dir is None:
        config_dir = Path.home() / f".{ide}"
    backup_dir = config_dir / PATCH_BACKUP_DIR_NAME
    backup_dir.mkdir(parents=True, exist_ok=True)
    return backup_dir


def _find_extension_path(ide: str) -> Path | None:
    """Locate the main extension file for an IDE."""
    installation = detect_ide(ide)
    if installation is None:
        return None

    candidates = _IDE_EXTENSION_FILES.get(ide, ["dist/extension.js"])
    for rel in candidates:
        candidate = installation.install_path / rel
        if candidate.exists():
            return candidate
    return None


def _read_patch_version(file_path: Path) -> str | None:
    """Extract patch version marker from a patched file."""
    try:
        content = file_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    # Check V3 marker
    if "/* STITCH_PATCHED - V3 WITH CONFIGURATION */" in content:
        return "V3"
    if INJECTION_MARKER in content:
        # Try to extract version from marker comment
        match = re.search(r"STITCH_PATCH_INJECTED\s+v(\S+)", content)
        return f"v{match.group(1)}" if match else "unknown"
    return None


def _is_ide_running(ide: str) -> bool:
    """Check if an IDE process is currently running."""
    process_names: dict[str, list[str]] = {
        "kiro": ["kiro"],
        "windsurf": ["windsurf", "Windsurf"],
        "cursor": ["cursor", "Cursor"],
        "trae": ["trae", "Trae"],
    }
    names = process_names.get(ide, [ide])
    try:
        import psutil
        for proc in psutil.process_iter(["name"]):
            pname = proc.info.get("name") or ""
            if any(n.lower() in pname.lower() for n in names):
                return True
    except ImportError:
        # Fallback: tasklist on Windows
        import platform
        import subprocess
        if platform.system() == "Windows":
            try:
                out = subprocess.check_output(["tasklist"], text=True, stderr=subprocess.DEVNULL)
                for name in names:
                    if name.lower() in out.lower():
                        return True
            except Exception:
                pass
    return False


# ── Commands ───────────────────────────────────────────────────────────────


@register_command("get_ide_status")
async def cmd_get_ide_status(params: dict) -> dict:
    """Detect all IDEs and return their status (installed, patched, running)."""
    installations = detect_all_ides()

    ides: list[dict[str, Any]] = []
    for inst in installations:
        ext_path = _find_extension_path(inst.ide_id)
        patch_version = _read_patch_version(ext_path) if ext_path else None
        running = _is_ide_running(inst.ide_id)

        ides.append({
            "id": inst.ide_id,
            "name": inst.display_name,
            "displayName": inst.display_name,
            "installed": True,
            "running": running,
            "isRunning": running,
            "dataPath": str(inst.install_path),
            "installPath": str(inst.install_path),
            "version": inst.version,
            "isPatched": patch_version is not None,
            "patchVersion": patch_version,
            "canPatch": ext_path is not None and patch_version is None,
        })

    return {
        "ides": ides,
        "totalInstalled": len(ides),
        "totalRunning": sum(1 for i in ides if i["running"]),
        "totalDetected": len(ides),
    }


@register_command("get_patch_status")
async def cmd_get_patch_status(params: dict) -> dict:
    """Return detailed patch status for a single IDE."""
    ide = params.get("ideType", params.get("ide", "kiro"))
    installation = detect_ide(ide)
    ext_path = _find_extension_path(ide)

    if installation is None or ext_path is None:
        return {
            "ideType": ide,
            "status": "not_installed",
            "extensionValid": False,
            "extensionPath": None,
            "backupExists": False,
            "backupValid": False,
            "backupPath": None,
            "patternsApplied": 0,
            "totalPatterns": 0,
            "fileHash": None,
            "patchVersion": None,
        }

    patch_version = _read_patch_version(ext_path)
    backup_dir = _get_backup_dir(ide)
    backup_files = list(backup_dir.glob("*.bak"))
    file_hash = file_checksum(ext_path)

    status = "applied" if patch_version else "not_applied"

    return {
        "ideType": ide,
        "status": status,
        "extensionValid": True,
        "extensionPath": str(ext_path),
        "backupExists": bool(backup_files),
        "backupValid": bool(backup_files),
        "backupPath": str(backup_dir) if backup_files else None,
        "patternsApplied": 1 if patch_version else 0,
        "totalPatterns": 1,
        "fileHash": file_hash,
        "patchVersion": patch_version,
    }


@register_command("apply_patch")
async def cmd_apply_patch(params: dict) -> dict:
    """Apply the stitch patch to an IDE's extension file.

    Creates a backup first, then injects the stitch marker + config
    into the extension file.
    """
    ide = params.get("ideType", params.get("ide", "kiro"))
    do_backup = params.get("createBackup", True)

    ext_path = _find_extension_path(ide)
    if ext_path is None:
        return {"success": False, "message": f"Extension file not found for {ide}"}

    # Guard: already patched
    content = ext_path.read_text(encoding="utf-8", errors="replace")
    if INJECTION_MARKER in content:
        return {"success": False, "message": f"{ide} is already patched"}

    # Backup
    backup_path: str | None = None
    if do_backup:
        backup_dir = _get_backup_dir(ide)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        dst = backup_dir / f"extension_{ts}.js.bak"
        shutil.copy2(ext_path, dst)
        backup_path = str(dst)

    # Inject marker + minimal config hook
    injection_block = (
        f"\n{INJECTION_MARKER}\n"
        "// Stitch Manager — account injection hook\n"
        "// This marker identifies files patched by Stitch Manager.\n"
    )
    new_content = content + injection_block
    ext_path.write_text(new_content, encoding="utf-8")

    logger.info("Patch applied to %s (%s)", ide, ext_path)
    return {
        "success": True,
        "message": f"Patch applied to {ide}",
        "backupPath": backup_path,
    }


@register_command("remove_patch")
async def cmd_remove_patch(params: dict) -> dict:
    """Remove the stitch patch from an IDE, restoring from backup if available."""
    ide = params.get("ideType", params.get("ide", "kiro"))

    ext_path = _find_extension_path(ide)
    if ext_path is None:
        return {"success": False, "message": f"Extension file not found for {ide}"}

    # Try restoring from backup first
    backup_dir = _get_backup_dir(ide)
    backups = sorted(backup_dir.glob("*.bak"), key=lambda p: p.stat().st_mtime, reverse=True)
    restored = False
    if backups:
        latest = backups[0]
        shutil.copy2(latest, ext_path)
        logger.info("Restored %s from backup %s", ext_path, latest)
        restored = True
    else:
        # Fallback: strip injection block from current file
        content = ext_path.read_text(encoding="utf-8", errors="replace")
        if INJECTION_MARKER in content:
            # Remove everything from the marker to end of injection block
            content = re.sub(
                r"\n" + re.escape(INJECTION_MARKER) + r"\n.*?// This marker.*?\n",
                "\n",
                content,
                flags=re.DOTALL,
            )
            ext_path.write_text(content, encoding="utf-8")
            logger.info("Cleaned injection code from %s", ext_path)
            restored = True

    return {
        "success": restored,
        "message": "Restored from backup" if restored else "No patch or backup found to remove",
        "backupPath": None,
    }


@register_command("list_backups")
async def cmd_list_backups(params: dict) -> dict:
    """List all backups for an IDE."""
    ide = params.get("ideType", params.get("ide", "kiro"))
    backup_dir = _get_backup_dir(ide)

    backups: list[dict[str, Any]] = []
    for f in sorted(backup_dir.glob("*.bak"), key=lambda p: p.stat().st_mtime, reverse=True):
        stat = f.stat()
        backups.append({
            "path": str(f),
            "name": f.name,
            "createdAt": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            "fileSize": stat.st_size,
        })

    return {"backups": backups}


@register_command("restore_backup")
async def cmd_restore_backup(params: dict) -> dict:
    """Restore a specific backup file for an IDE."""
    ide = params.get("ideType", params.get("ide", "kiro"))
    backup_path_str = params.get("backupPath", "")

    if not backup_path_str:
        return {"success": False, "message": "No backupPath specified"}

    backup_file = Path(backup_path_str)
    if not backup_file.exists():
        return {"success": False, "message": f"Backup file not found: {backup_file}"}

    ext_path = _find_extension_path(ide)
    if ext_path is None:
        return {"success": False, "message": f"Extension file not found for {ide}"}

    shutil.copy2(backup_file, ext_path)
    logger.info("Restored %s from backup %s", ext_path, backup_file)
    return {"success": True, "message": f"Restored from {backup_file.name}"}
