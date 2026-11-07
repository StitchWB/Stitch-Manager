"""Scan known local paths for installed IDEs and provider auth JSON files."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class DetectedIde:
    name: str
    display_name: str
    path: str
    version: str = ""
    configured: bool = False
    config_path: str = ""
    installed: bool = True


def opencode_config_path() -> Path:
    """Resolve ``opencode.json``; honours the host-injected config dir."""
    injected = os.environ.get("STITCH_OPENCODE_CONFIG_DIR", "").strip()
    base = Path(injected) if injected else Path.home() / ".config" / "opencode"
    return base / "opencode.json"


def ide_config_path(ide_id: str) -> Path | None:
    if ide_id == "opencode":
        return opencode_config_path()
    appdata = os.environ.get("APPDATA", "")
    app = {"cursor": "Cursor", "windsurf": "Windsurf", "trae": "Trae", "kiro": "Kiro"}.get(ide_id)
    if app and appdata:
        return Path(appdata) / app / "User" / "settings.json"
    return None


def _opencode_configured(path: Path) -> bool:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return False
    provider = data.get("provider") if isinstance(data, dict) else None
    return isinstance(provider, dict) and "stitch" in provider


class IdeDetector:
    """Scan known paths for installed IDEs."""

    _KNOWN_IDES: list[tuple[str, str, list[str]]] = [
        ("kiro", "Kiro", [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Kiro"),
            os.path.expandvars(r"%LOCALAPPDATA%\Kiro"),
        ]),
        ("cursor", "Cursor", [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Cursor"),
            os.path.expandvars(r"%LOCALAPPDATA%\Cursor"),
        ]),
        ("windsurf", "Windsurf", [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Windsurf"),
            os.path.expandvars(r"%LOCALAPPDATA%\Windsurf"),
        ]),
        ("trae", "Trae", [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Trae"),
            os.path.expandvars(r"%LOCALAPPDATA%\Trae"),
        ]),
        ("opencode", "OpenCode", [
            os.path.expandvars(r"%USERPROFILE%\.opencode"),
            str(Path.home() / ".opencode"),
            str(opencode_config_path().parent),
        ]),
    ]

    @classmethod
    def detect_all(cls) -> list[DetectedIde]:
        found: list[DetectedIde] = []
        for ide_id, display_name, candidates in cls._KNOWN_IDES:
            for path in candidates:
                if Path(path).exists():
                    config_path = ide_config_path(ide_id)
                    found.append(DetectedIde(
                        name=ide_id,
                        display_name=display_name,
                        path=path,
                        config_path=str(config_path) if config_path else "",
                        configured=(
                            ide_id == "opencode"
                            and config_path is not None
                            and _opencode_configured(config_path)
                        ),
                    ))
                    break
        return found


@dataclass
class AuthFile:
    provider: str
    path: str
    token: str
    expires_at: int | None = None


class AuthFileScanner:
    """Scan standard locations for auth JSON files."""

    _PROVIDERS = ("openai", "gemini", "anthropic", "kiro", "fireworks")

    @classmethod
    def scan_all(cls) -> list[AuthFile]:
        results: list[AuthFile] = []
        search_dirs = [
            Path.home() / ".stitch-manager" / "auth",
            Path.home() / ".config" / "stitch",
        ]
        for d in search_dirs:
            if not d.is_dir():
                continue
            for f in d.iterdir():
                if not f.is_file() or f.suffix != ".json":
                    continue
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                    provider = data.get("provider", "")
                    token = data.get("token", data.get("apiKey", data.get("api_key", "")))
                    if not provider or not token:
                        continue
                    results.append(AuthFile(
                        provider=provider,
                        path=str(f),
                        token=token,
                        expires_at=data.get("expiresAt") or data.get("expires_at"),
                    ))
                except (json.JSONDecodeError, OSError):
                    continue
        return results
