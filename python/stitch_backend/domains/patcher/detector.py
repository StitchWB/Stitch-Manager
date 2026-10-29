"""Detect installed IDEs and their patchable locations."""

from __future__ import annotations

import platform
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class IDEInstallation:
    """Represents a detected IDE installation."""

    ide_id: str
    name: str
    display_name: str
    install_path: Path | None = None
    version: str | None = None
    executable: Path | None = None
    config_dir: Path | None = None
    is_patched: bool = False
    metadata: dict = field(default_factory=dict)


# ── Known IDE locations ──────────────────────────────────────────────────────

_WINDOWS_PATHS: dict[str, list[str]] = {
    "kiro": [
        r"%LOCALAPPDATA%\Programs\Kiro",
        r"%LOCALAPPDATA%\Kiro",
        r"S:\Kiro",  # Custom installation path
    ],
    "windsurf": [
        r"%LOCALAPPDATA%\Programs\Windsurf",
        r"%LOCALAPPDATA%\Windsurf",
        r"S:\Windsurf",  # Custom installation path
    ],
    "cursor": [
        r"%LOCALAPPDATA%\Programs\Cursor",
        r"%LOCALAPPDATA%\Cursor",
        r"S:\Cursor",  # Custom installation path
    ],
    "trae": [
        r"%LOCALAPPDATA%\Programs\Trae",
        r"%LOCALAPPDATA%\Trae",
        r"S:\Trae",  # Custom installation path
    ],
}

_LINUX_PATHS: dict[str, list[str]] = {
    "kiro": ["/opt/kiro", "/usr/share/kiro", "$HOME/.local/share/kiro"],
    "windsurf": ["/opt/windsurf", "/usr/share/windsurf"],
    "cursor": ["/opt/cursor", "/usr/share/cursor"],
    "trae": ["/opt/trae", "/usr/share/trae"],
}

_MACOS_PATHS: dict[str, list[str]] = {
    "kiro": ["/Applications/Kiro.app"],
    "windsurf": ["/Applications/Windsurf.app"],
    "cursor": ["/Applications/Cursor.app"],
    "trae": ["/Applications/Trae.app"],
}

_DISPLAY_NAMES: dict[str, str] = {
    "kiro": "Kiro IDE",
    "windsurf": "Windsurf",
    "cursor": "Cursor",
    "trae": "Trae",
}


def _expand_env_paths(paths: list[str]) -> list[Path]:
    """Expand environment variables in path templates."""
    import os

    result = []
    for p in paths:
        expanded = os.path.expandvars(p)
        expanded = os.path.expanduser(expanded)
        result.append(Path(expanded))
    return result


def _get_platform_paths() -> dict[str, list[Path]]:
    """Return platform-specific IDE search paths."""
    system = platform.system()
    if system == "Windows":
        raw = _WINDOWS_PATHS
    elif system == "Darwin":
        raw = _MACOS_PATHS
    else:
        raw = _LINUX_PATHS

    return {ide: _expand_env_paths(paths) for ide, paths in raw.items()}


def detect_ide(ide_id: str) -> IDEInstallation | None:
    """Detect a single IDE installation."""
    paths = _get_platform_paths().get(ide_id, [])
    for p in paths:
        if p.exists():
            return IDEInstallation(
                ide_id=ide_id,
                name=ide_id.capitalize(),
                display_name=_DISPLAY_NAMES.get(ide_id, ide_id),
                install_path=p,
            )
    return None


def detect_all_ides() -> list[IDEInstallation]:
    """Detect all supported IDEs (installed or not)."""
    found: list[IDEInstallation] = []
    for ide_id in _DISPLAY_NAMES:
        install = detect_ide(ide_id)
        if install is not None:
            found.append(install)
        else:
            # Return placeholder for unsupported IDE
            found.append(IDEInstallation(
                ide_id=ide_id,
                name=ide_id.capitalize(),
                display_name=_DISPLAY_NAMES.get(ide_id, ide_id),
                install_path=None,
            ))
    return found


def get_config_dir(ide_id: str) -> Path | None:
    """Return the user-level config directory for an IDE."""
    home = Path.home()
    config_dirs = {
        "kiro": home / ".kiro",
        "windsurf": home / ".windsurf",
        "cursor": home / ".cursor",
        "trae": home / ".trae",
    }
    p = config_dirs.get(ide_id)
    return p if p and p.exists() else None
