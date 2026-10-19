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
        ]),
    ]

    @classmethod
    def detect_all(cls) -> list[DetectedIde]:
        found: list[DetectedIde] = []
        for ide_id, display_name, candidates in cls._KNOWN_IDES:
            for path in candidates:
                if Path(path).exists():
                    found.append(DetectedIde(
                        name=ide_id,
                        display_name=display_name,
                        path=path,
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
