"""Telemetry / Machine ID service — cross-platform port of Rust MachineIdService.

Manages:
- Telemetry IDs (machine_id, sqm_id, dev_device_id, service_machine_id)
- System GUID
- Backup/restore of telemetry data

Storage: JSON files under ``~/.stitch-manager/telemetry/``.
"""

from __future__ import annotations

import json
import logging
import platform
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_TELEMETRY_DIR = Path.home() / ".stitch-manager" / "telemetry"
_TELEMETRY_FILE = _TELEMETRY_DIR / "telemetry.json"
_BACKUP_DIR = _TELEMETRY_DIR / "backups"


def _generate_id() -> str:
    return str(uuid.uuid4())


def _load_telemetry() -> dict[str, str]:
    if _TELEMETRY_FILE.exists():
        try:
            return json.loads(_TELEMETRY_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    # Generate fresh telemetry
    data = {
        "machineId": _generate_id(),
        "sqmId": _generate_id(),
        "devDeviceId": _generate_id(),
        "serviceMachineId": _generate_id(),
        "kiroInstalled": False,
    }
    _TELEMETRY_DIR.mkdir(parents=True, exist_ok=True)
    _TELEMETRY_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


def _save_telemetry(data: dict[str, str]) -> None:
    _TELEMETRY_DIR.mkdir(parents=True, exist_ok=True)
    _TELEMETRY_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


class TelemetryService:
    """File-based telemetry management — mirrors Rust MachineIdService."""

    @staticmethod
    def get_telemetry() -> dict[str, Any]:
        return _load_telemetry()

    @staticmethod
    def reset_telemetry() -> dict[str, Any]:
        old = _load_telemetry()
        new_data = {
            "machineId": _generate_id(),
            "sqmId": _generate_id(),
            "devDeviceId": _generate_id(),
            "serviceMachineId": _generate_id(),
            "kiroInstalled": False,
        }
        _save_telemetry(new_data)
        return {
            "success": True,
            "message": "Telemetry reset successfully",
            "oldTelemetry": old,
            "newTelemetry": new_data,
        }

    @staticmethod
    def backup_telemetry() -> dict[str, Any]:
        data = _load_telemetry()
        _BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        backup_path = _BACKUP_DIR / f"telemetry_{ts}.json"
        backup_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return {
            "success": True,
            "message": f"Telemetry backed up to {backup_path}",
            "backupPath": str(backup_path),
            "timestamp": ts,
        }

    @staticmethod
    def restore_telemetry(backup_path: str | None = None) -> dict[str, Any]:
        if backup_path:
            p = Path(backup_path)
        else:
            # Find most recent backup
            backups = sorted(_BACKUP_DIR.glob("telemetry_*.json"), reverse=True)
            if not backups:
                return {"success": False, "message": "No backup files found"}
            p = backups[0]

        if not p.exists():
            return {"success": False, "message": f"Backup not found: {p}"}

        try:
            restored = json.loads(p.read_text(encoding="utf-8"))
        except Exception as exc:
            return {"success": False, "message": f"Failed to read backup: {exc}"}

        _save_telemetry(restored)
        return {
            "success": True,
            "message": f"Telemetry restored from {p}",
            "restoredFrom": str(p),
            "restoredTelemetry": restored,
        }

    @staticmethod
    def get_system_machine_info() -> dict[str, Any]:
        telemetry = _load_telemetry()
        system = platform.system()
        return {
            "machineGuid": telemetry.get("machineId", ""),
            "osType": system,
            "canModify": True,
            "requiresAdmin": system == "Windows",
            "backupExists": any(_BACKUP_DIR.glob("telemetry_*.json")) if _BACKUP_DIR.exists() else False,
        }

    @staticmethod
    def reset_system_guid(force: bool = False, create_backup: bool = True) -> dict[str, Any]:
        if create_backup:
            TelemetryService.backup_telemetry()

        data = _load_telemetry()
        old_guid = data.get("machineId", "")
        data["machineId"] = _generate_id()
        data["sqmId"] = _generate_id()
        data["serviceMachineId"] = _generate_id()
        _save_telemetry(data)

        return {
            "success": True,
            "message": "System GUID reset successfully",
            "oldGuid": old_guid,
            "newGuid": data["machineId"],
            "backupPath": str(_BACKUP_DIR) if create_backup else None,
            "requiresRestart": True,
        }

    @staticmethod
    def full_reset(reset_kiro: bool = True, reset_system: bool = False, create_backups: bool = True) -> dict[str, Any]:
        errors: list[str] = []
        new_telemetry = None
        new_system_guid = None

        if create_backups:
            try:
                TelemetryService.backup_telemetry()
            except Exception as exc:
                errors.append(f"Backup failed: {exc}")

        if reset_kiro:
            try:
                result = TelemetryService.reset_telemetry()
                new_telemetry = result.get("newTelemetry")
            except Exception as exc:
                errors.append(f"Kiro telemetry reset failed: {exc}")

        if reset_system:
            try:
                result = TelemetryService.reset_system_guid(force=True, create_backup=False)
                new_system_guid = result.get("newGuid")
            except Exception as exc:
                errors.append(f"System GUID reset failed: {exc}")

        return {
            "kiroReset": reset_kiro,
            "systemReset": reset_system,
            "newTelemetry": new_telemetry,
            "newSystemGuid": new_system_guid,
            "errors": errors,
            "backupsCreated": create_backups,
        }

