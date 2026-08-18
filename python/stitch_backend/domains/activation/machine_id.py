"""Machine ID generation and IDE patching.

Generates unique hardware-like identifiers and patches IDE configuration
files to bind accounts to specific machines. Uses platform-correct paths:

- Windows: ``HKLM\\SOFTWARE\\Microsoft\\Cryptography\\MachineGuid`` (registry via subprocess)
- macOS: ``~/Library/Application Support/Kiro/machineid`` (file)
- Linux: ``/etc/machine-id`` (file)
"""

from __future__ import annotations

import hashlib
import logging
import platform
import subprocess
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def generate_machine_id(seed: str = "") -> str:
    """Generate a deterministic or random machine UUID.

    If ``seed`` is provided, the ID is deterministic (SHA-256 based).
    Otherwise a random UUID4 is returned.
    """
    if seed:
        return hashlib.sha256(seed.encode()).hexdigest()[:36]
    return str(uuid.uuid4())


def _os_type() -> str:
    system = platform.system()
    if system == "Windows":
        return "windows"
    elif system == "Darwin":
        return "macos"
    elif system == "Linux":
        return "linux"
    return "unknown"


# ── Platform-specific paths for Kiro IDE ────────────────────────────────────

_KiroMachineIdPaths: dict[str, dict[str, str | None]] = {
    "kiro": {
        "windows": None,  # registry: HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid
        "macos": str(Path.home() / "Library" / "Application Support" / "Kiro" / "machineid"),
        "linux": "/etc/machine-id",
    },
    "windsurf": {
        "windows": None,
        "macos": str(Path.home() / "Library" / "Application Support" / "Windsurf" / "machineid"),
        "linux": "/etc/machine-id",
    },
    "cursor": {
        "windows": None,
        "macos": str(Path.home() / "Library" / "Application Support" / "Cursor" / "machineid"),
        "linux": "/etc/machine-id",
    },
}

_WIN_REG_KEY = r"HKLM\SOFTWARE\Microsoft\Cryptography"
_WIN_REG_VALUE = "MachineGuid"


def _is_permission_error(exc_or_msg: str | Exception) -> bool:
    msg = str(exc_or_msg).lower()
    indicators = (
        "access is denied", "permission denied",
        "operation not permitted", "eperm", "eacces",
        "requested registry access is not allowed",
    )
    return any(ind in msg for ind in indicators)


# ── Windows helpers ─────────────────────────────────────────────────────────

def _win_read_machine_guid() -> dict[str, Any]:
    """Read MachineGuid from Windows registry."""
    try:
        result = subprocess.run(
            ["reg", "query", _WIN_REG_KEY, "/v", _WIN_REG_VALUE],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return {"success": False, "error": result.stderr.strip() or "reg query failed"}
        for line in result.stdout.splitlines():
            line = line.strip()
            if _WIN_REG_VALUE in line and "REG_SZ" in line:
                parts = line.rsplit(None, 1)
                if len(parts) == 2:
                    return {"success": True, "machineId": parts[1].strip().lower()}
        return {"success": False, "error": "MachineGuid not found in registry output"}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "reg query timed out"}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def _win_write_machine_guid(machine_id: str) -> dict[str, Any]:
    """Write MachineGuid to Windows registry."""
    try:
        result = subprocess.run(
            ["reg", "add", _WIN_REG_KEY, "/v", _WIN_REG_VALUE,
             "/t", "REG_SZ", "/d", machine_id, "/f"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            err = result.stderr.strip()
            if _is_permission_error(err):
                return {"success": False, "error": err, "requiresAdmin": True}
            return {"success": False, "error": err or "reg add failed"}
        return {"success": True, "machineId": machine_id}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "reg add timed out"}
    except Exception as exc:
        if _is_permission_error(exc):
            return {"success": False, "error": str(exc), "requiresAdmin": True}
        return {"success": False, "error": str(exc)}


# ── File-based helpers (macOS / Linux) ──────────────────────────────────────

def _file_read_machine_id(path: Path) -> dict[str, Any]:
    try:
        if not path.exists():
            return {"success": False, "error": f"File not found: {path}"}
        mid = path.read_text(encoding="utf-8").strip()
        if mid:
            return {"success": True, "machineId": mid.lower()}
        return {"success": False, "error": f"Empty file: {path}"}
    except PermissionError as exc:
        return {"success": False, "error": str(exc), "requiresAdmin": True}
    except Exception as exc:
        if _is_permission_error(exc):
            return {"success": False, "error": str(exc), "requiresAdmin": True}
        return {"success": False, "error": str(exc)}


def _file_write_machine_id(path: Path, machine_id: str) -> dict[str, Any]:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(machine_id, encoding="utf-8")
        return {"success": True, "machineId": machine_id}
    except PermissionError as exc:
        return {"success": False, "error": str(exc), "requiresAdmin": True}
    except Exception as exc:
        if _is_permission_error(exc):
            return {"success": False, "error": str(exc), "requiresAdmin": True}
        return {"success": False, "error": str(exc)}


# ── Public API ──────────────────────────────────────────────────────────────

async def patch_machine_id(
    account_id: str,
    machine_id: str,
    ide: str = "kiro",
) -> dict[str, Any]:
    """Patch the IDE config to use the given machine ID.

    Platform-specific:
    - Windows: writes ``HKLM\\SOFTWARE\\Microsoft\\Cryptography\\MachineGuid``
      via ``reg add`` (requires admin).
    - macOS: writes ``~/Library/Application Support/Kiro/machineid`` (file).
    - Linux: writes ``/etc/machine-id`` (file, requires admin).
    """
    os_type = _os_type()
    if os_type == "unknown":
        logger.warning("Unknown OS — skipping machine ID patch")
        return {"success": False, "error": "Unknown operating system"}

    ide_paths = _KiroMachineIdPaths.get(ide)
    if ide_paths is None:
        logger.warning("Unknown IDE '%s' — skipping machine ID patch", ide)
        return {"success": False, "error": f"Unknown IDE: {ide}"}

    if os_type == "windows":
        result = _win_write_machine_guid(machine_id)
    else:
        file_path_str = ide_paths.get(os_type)
        if file_path_str is None:
            return {"success": False, "error": f"No path for {ide} on {os_type}"}
        result = _file_write_machine_id(Path(file_path_str), machine_id)

    if result.get("success"):
        result["ide"] = ide
        logger.info("Machine ID patched for %s on %s: %s", ide, os_type, machine_id)
    else:
        logger.warning("Failed to patch machine ID for %s: %s", ide, result.get("error"))
    return result


async def get_machine_id(account_id: str, ide: str = "kiro") -> str | None:
    """Read the current machine ID for an IDE.

    Platform-specific:
    - Windows: reads ``HKLM\\SOFTWARE\\Microsoft\\Cryptography\\MachineGuid``
      via ``reg query``.
    - macOS: reads ``~/Library/Application Support/Kiro/machineid`` (file).
    - Linux: reads ``/etc/machine-id`` (file).
    """
    os_type = _os_type()
    if os_type == "unknown":
        return None

    ide_paths = _KiroMachineIdPaths.get(ide)
    if ide_paths is None:
        return None

    if os_type == "windows":
        result = _win_read_machine_guid()
    else:
        file_path_str = ide_paths.get(os_type)
        if file_path_str is None:
            return None
        result = _file_read_machine_id(Path(file_path_str))

    return result.get("machineId") if result.get("success") else None
