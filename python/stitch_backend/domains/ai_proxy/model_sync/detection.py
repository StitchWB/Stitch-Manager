"""OpenCode detection: runtime version, config file layout, credential state.

CRITICAL: the runtime version is NEVER inferred from the config file dialect
alone as a first-class signal — OpenCode v2 normalizes v1 configs on read, so
a v1-shaped file does not mean a v1 runtime.  Detection order:

1. ``opencode --version`` (subprocess, short timeout)
2. ``cli.json`` exists in the config dir → v2
3. only ``tui.json`` exists → v1
4. top-level ``providers`` key in the config → v2 (weak, dialect-based)
5. otherwise unknown — callers must write v1-compatible output (v2 normalizes)
"""

from __future__ import annotations

import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from stitch_backend.domains.opencode_config.service import parse_jsonc

OPENCODE_DIRNAME = "opencode"


def default_opencode_dir() -> Path:
    override = os.environ.get("OPENCODE_CONFIG")
    if override:
        return Path(override).parent
    return Path.home() / ".config" / OPENCODE_DIRNAME


def _opencode_binary_candidates() -> list[Path]:
    candidates: list[Path] = []
    which = shutil.which("opencode")
    if which:
        candidates.append(Path(which))
    home = Path.home()
    candidates.append(home / ".opencode" / "bin" / "opencode.exe")
    candidates.append(home / ".opencode" / "bin" / "opencode")
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(Path(appdata) / "npm" / "opencode.cmd")
        candidates.append(Path(appdata) / "npm" / "opencode")
    # de-dup preserving order
    seen: set[str] = set()
    out: list[Path] = []
    for cand in candidates:
        key = str(cand).lower()
        if key not in seen:
            seen.add(key)
            out.append(cand)
    return out


def _parse_version_output(text: str) -> str | None:
    match = re.search(r"(\d+)\.(\d+)(?:\.\d+)?", text)
    if not match:
        return None
    major = int(match.group(1))
    return "v2" if major >= 2 else "v1"


def probe_opencode_binary(timeout: float = 4.0) -> tuple[str | None, str | None]:
    """Run ``opencode --version``.  Returns ``(schema, raw_output)``."""
    for candidate in _opencode_binary_candidates():
        try:
            if not candidate.exists() and shutil.which("opencode") is None:
                continue
            proc = subprocess.run(  # noqa: S603 — fixed binary, no shell
                [str(candidate), "--version"],
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
            output = (proc.stdout or "") + (proc.stderr or "")
            schema = _parse_version_output(output)
            if schema:
                return schema, output.strip()[:200]
        except (OSError, subprocess.SubprocessError):
            continue
    return None, None


def detect_opencode_version(
    config_dir: Path | None = None,
    *,
    binary_probe: Any = None,
) -> dict[str, Any]:
    """Detect the OpenCode config schema version.

    Returns ``{"version": "v1"|"v2"|"unknown", "source": str, "raw": str|None}``.
    ``binary_probe`` is injectable for tests: a callable returning
    ``(schema, raw)`` like :func:`probe_opencode_binary`.
    """
    config_dir = config_dir or default_opencode_dir()
    probe = binary_probe if binary_probe is not None else probe_opencode_binary
    schema, raw = probe()
    if schema in ("v1", "v2"):
        return {"version": schema, "source": "binary", "raw": raw}

    cli_json = config_dir / "cli.json"
    tui_json = config_dir / "tui.json"
    if cli_json.exists():
        return {"version": "v2", "source": "cli.json", "raw": None}
    if tui_json.exists():
        return {"version": "v1", "source": "tui.json", "raw": None}

    for name in ("opencode.jsonc", "opencode.json", "config.json"):
        path = config_dir / name
        if not path.exists():
            continue
        try:
            text = path.read_text(encoding="utf-8-sig")
            data = parse_jsonc(text)
        except Exception:
            continue
        if isinstance(data, dict) and isinstance(data.get("providers"), dict):
            return {"version": "v2", "source": "config-providers-key", "raw": None}

    return {"version": "unknown", "source": "default", "raw": None}


def resolve_schema(requested: str | None, detected: str) -> str:
    """Resolve user override ``auto|v1|v2`` against detection.

    Unknown detection falls back to v1-compatible output — v2 normalizes it.
    """
    if requested in ("v1", "v2"):
        return requested
    if detected in ("v1", "v2"):
        return detected
    return "v1"


@dataclass
class OpenCodeLayout:
    """Resolved opencode config file layout."""

    config_dir: Path
    write_target: Path
    primary_path: Path | None = None
    secondary_path: Path | None = None
    config_json_path: Path | None = None
    explicit: bool = False
    warnings: list[str] = field(default_factory=list)


def resolve_opencode_layout(
    config_path: str | None = None,
    config_dir: str | Path | None = None,
) -> OpenCodeLayout:
    """Resolve write target + split-file situation.

    Precedence (per opencode merge order ``config.json`` → ``opencode.json`` →
    ``opencode.jsonc`` — later wins): when BOTH ``opencode.json`` and
    ``opencode.jsonc`` exist, the jsonc file is the highest-precedence write
    target and the json file only gets its stitch entry purged.
    ``config.json`` is detected and warned about but NEVER written.
    """
    base_dir = Path(config_dir) if config_dir else default_opencode_dir()
    warnings: list[str] = []

    config_json = base_dir / "config.json"
    config_json_path = config_json if config_json.exists() else None
    if config_json_path is not None:
        warnings.append("config.json present — detected for reading only; stitch never writes it")

    if config_path:
        target = Path(config_path)
        return OpenCodeLayout(
            config_dir=target.parent,
            write_target=target,
            primary_path=target if target.exists() else None,
            config_json_path=config_json_path,
            explicit=True,
            warnings=warnings,
        )

    jsonc = base_dir / "opencode.jsonc"
    plain = base_dir / "opencode.json"
    if jsonc.exists() and plain.exists():
        warnings.append(
            "both opencode.json and opencode.jsonc present — writing stitch block "
            "to opencode.jsonc (highest precedence) and purging the stitch entry "
            "from opencode.json"
        )
        return OpenCodeLayout(
            config_dir=base_dir,
            write_target=jsonc,
            primary_path=jsonc,
            secondary_path=plain,
            config_json_path=config_json_path,
            warnings=warnings,
        )
    if jsonc.exists():
        return OpenCodeLayout(
            config_dir=base_dir,
            write_target=jsonc,
            primary_path=jsonc,
            config_json_path=config_json_path,
            warnings=warnings,
        )
    if plain.exists():
        return OpenCodeLayout(
            config_dir=base_dir,
            write_target=plain,
            primary_path=plain,
            config_json_path=config_json_path,
            warnings=warnings,
        )
    return OpenCodeLayout(
        config_dir=base_dir,
        write_target=plain,
        primary_path=None,
        config_json_path=config_json_path,
        warnings=warnings,
    )


def _credential_db_candidates() -> list[Path]:
    home = Path.home()
    candidates: list[Path] = []
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(Path(appdata) / "opencode" / "opencode.db")
    candidates.append(home / ".local" / "share" / "opencode" / "opencode.db")
    return candidates


def check_stitch_credential(token: str | None) -> dict[str, Any]:
    """Compare the active stored v2 credential for integration ``stitch``.

    The opencode.db sqlite file is WAL-locked by the running app, so it is
    COPIED to a temp file first and opened read-only.  The database is never
    written and the key value is never returned or logged.

    Returns ``{"status": ..., "detail": ...}`` with status one of
    ``credential-match`` / ``credential-mismatch`` / ``no-credential`` /
    ``no-database`` / ``unknown``.
    """
    db_path = next((p for p in _credential_db_candidates() if p.exists()), None)
    if db_path is None:
        return {"status": "no-database", "detail": "opencode.db not found"}

    tmp_name: str | None = None
    try:
        fd, tmp_name = tempfile.mkstemp(prefix="opencode-db-", suffix=".copy")
        os.close(fd)
        shutil.copy2(db_path, tmp_name)
        uri = f"file:{Path(tmp_name).as_posix()}?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
        try:
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            table = next((t for t in tables if "credential" in t.lower()), None)
            if table is None:
                return {"status": "unknown", "detail": "no credential table in opencode.db"}
            columns = {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")').fetchall()}
            id_col = next(
                (
                    c
                    for c in columns
                    if c.lower() in ("integration_id", "integrationid", "provider")
                ),
                None,
            )
            key_col = next(
                (
                    c
                    for c in columns
                    if c.lower() in ("key", "api_key", "apikey", "token", "secret", "value")
                ),
                None,
            )
            if id_col is None or key_col is None:
                return {"status": "unknown", "detail": "credential table shape not recognised"}
            rows = conn.execute(
                f'SELECT "{key_col}" FROM "{table}" WHERE "{id_col}" = ?',
                ("stitch",),
            ).fetchall()
        finally:
            conn.close()
    except Exception as exc:  # never fail detection because of the probe
        return {"status": "unknown", "detail": f"credential probe failed: {exc!r}"[:200]}
    finally:
        if tmp_name:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass

    if not rows:
        return {"status": "no-credential", "detail": "no stitch credential stored"}
    if token is None:
        return {"status": "unknown", "detail": "no local token to compare against"}
    active = rows[0][0]
    if isinstance(active, str) and active == token:
        return {"status": "credential-match", "detail": "stored credential matches current token"}
    return {
        "status": "credential-mismatch",
        "detail": "stored credential differs from current token — re-auth may be required",
    }
