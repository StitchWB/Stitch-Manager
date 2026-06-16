"""Patcher service — Trae patch stubs + IDE verification.

Ported from Rust ``commands/provider.rs`` (Trae section).
All Trae operations are stubs returning ``success: false`` with a
"coming soon" message — matching the Rust implementation.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── PatchResult shape ─────────────────────────────────────────────────────────

def _patch_result(success: bool, message: str, backup_path: str | None = None) -> dict[str, Any]:
    return {"success": success, "message": message, "backupPath": backup_path}


# ── Trae stubs ────────────────────────────────────────────────────────────────

def patch_trae_storage() -> dict[str, Any]:
    return _patch_result(False, "Trae storage patching is coming soon.")


def restore_trae_storage(backup_path: str) -> dict[str, Any]:
    return _patch_result(False, "Trae restore is not implemented yet.")


def patch_trae_extension() -> dict[str, Any]:
    return _patch_result(False, "Trae extension patching is coming soon.")


def patch_trae_workbench() -> dict[str, Any]:
    return _patch_result(False, "Trae workbench patching is coming soon.")


def patch_trae_full() -> dict[str, Any]:
    return _patch_result(False, "Trae full patch is coming soon.")


# ── IDE verification ──────────────────────────────────────────────────────────

# Known IDE installation directories per platform
_IDE_SEARCH_PATHS: dict[str, list[str]] = {
    "kiro": [
        "{LOCALAPPDATA}/Programs/Kiro",
        "/Applications/Kiro.app",
        "{HOME}/.local/share/Kiro",
    ],
    "trae": [
        "{LOCALAPPDATA}/Programs/Trae",
        "/Applications/Trae.app",
        "{HOME}/.local/share/Trae",
    ],
    "cursor": [
        "{LOCALAPPDATA}/Programs/Cursor",
        "/Applications/Cursor.app",
        "{HOME}/.local/share/Cursor",
    ],
    "windsurf": [
        "{LOCALAPPDATA}/Programs/Windsurf",
        "/Applications/Windsurf.app",
        "{HOME}/.local/share/Windsurf",
    ],
}


def _expand_path(template: str) -> Path:
    """Expand environment variables in a path template."""
    home = str(Path.home())
    local_app = os.environ.get("LOCALAPPDATA", "")
    expanded = template.replace("{HOME}", home).replace("{LOCALAPPDATA}", local_app)
    return Path(expanded)


def verify_ide(ide_id: str) -> bool:
    """Check whether an IDE is installed on the system.

    Matches Rust: ``PatcherService::new(ide_id).is_installed()``.
    """
    ide_id_lower = ide_id.lower().strip()
    search_templates = _IDE_SEARCH_PATHS.get(ide_id_lower, [])

    for template in search_templates:
        path = _expand_path(template)
        if path.exists():
            return True

    # Fallback: search all known IDE paths (handles aliases / custom IDs)
    for name, templates in _IDE_SEARCH_PATHS.items():
        if name != ide_id_lower:
            for template in templates:
                if _expand_path(template).exists():
                    return True

    return False
