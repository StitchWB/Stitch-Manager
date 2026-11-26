"""OpenCode detection: runtime versions, config file layout, credential state.

OpenCode v1 and v2 are *separate* binaries on real machines: ``opencode``
(v1.x) and ``opencode2`` (v2.x, npm ``@opencode/cli``).  npm also creates an
extensionless shell shim next to the executable Windows shims; that shim is
visible to ``shutil.which`` but cannot be launched directly by subprocess on
Windows.  Candidate expansion therefore always tries the sibling ``.cmd`` /
``.exe`` / ``.bat`` forms as well.

Generation rule: the presence of a working ``opencode2`` binary (or
``cli.json``) means the v2 dialect.  v2 normalizes v1-shaped configs, and when
both binaries are installed v2 is the primary runtime.  A v1 ``opencode``
binary never downgrades that decision.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from stitch_backend.domains.opencode_config.service import parse_jsonc

OPENCODE_DIRNAME = "opencode"
_WINDOWS_SHIM_SUFFIXES = (".cmd", ".exe", ".bat")


def default_opencode_dir() -> Path:
    override = os.environ.get("OPENCODE_CONFIG")
    if override:
        return Path(override).parent
    return Path.home() / ".config" / OPENCODE_DIRNAME


def _dedupe_paths(candidates: list[Path]) -> list[Path]:
    seen: set[str] = set()
    out: list[Path] = []
    for cand in candidates:
        key = str(cand).lower()
        if key not in seen:
            seen.add(key)
            out.append(cand)
    return out


def _windows_sibling_variants(candidate: Path) -> list[Path]:
    """Return executable sibling variants for an npm shim on Windows.

    npm emits three shims: extensionless (a bash script), ``.cmd`` and
    ``.ps1``.  The extensionless one is often what ``which`` returns but it is
    not directly executable through ``subprocess`` on Windows.  ``.ps1`` is
    intentionally not used (it requires a PowerShell host); fixed argv arrays
    remain shell-free.
    """
    if os.name != "nt":
        return [candidate]
    suffix = candidate.suffix.lower()
    if suffix not in ("", *_WINDOWS_SHIM_SUFFIXES):
        return [candidate]
    base = candidate.with_suffix("") if suffix else candidate
    # Prefer directly launchable forms over the extensionless shell script.
    ordered = [
        base.with_suffix(".cmd"),
        base.with_suffix(".exe"),
        base.with_suffix(".bat"),
        candidate,
    ]
    return _dedupe_paths(ordered)


def _desktop_opencode_cli_candidates() -> list[Path]:
    """Bundled OpenCode Desktop v2 CLI locations, newest version first.

    OpenCode Desktop does not rely on the npm ``opencode2`` shim being on the
    backend process PATH.  On Windows it unpacks versioned runners under
    ``%APPDATA%\\ai.opencode.desktop\\cli\\<version>-<arch>`` and launches
    ``opencode-cli.exe`` directly.  Model-sync detection must therefore probe
    that layout independently; otherwise a real desktop install is reported as
    absent on machines whose npm bin directory is not inherited by the backend.
    """
    appdata = os.environ.get("APPDATA")
    if not appdata:
        return []
    root = Path(appdata) / "ai.opencode.desktop" / "cli"
    try:
        version_dirs = [path for path in root.iterdir() if path.is_dir()]
    except OSError:
        return []

    def version_key(path: Path) -> tuple[int, int, int, str]:
        match = re.match(r"(\d+)\.(\d+)(?:\.(\d+))?", path.name)
        if match is None:
            return (0, 0, 0, path.name)
        return (
            int(match.group(1)),
            int(match.group(2)),
            int(match.group(3) or 0),
            path.name,
        )

    candidates: list[Path] = []
    for directory in sorted(version_dirs, key=version_key, reverse=True):
        for filename in (
            "opencode-cli.exe",
            "opencode-cli.cmd",
            "opencode-cli.bat",
            "opencode-cli",
        ):
            candidate = directory / filename
            if candidate.exists():
                candidates.append(candidate)
    return _dedupe_paths(candidates)


def opencode_binary_candidates(binary_name: str = "opencode") -> list[Path]:
    """Candidate paths for an opencode-family binary, shim variants included."""
    candidates: list[Path] = []
    search_dirs: list[Path] = []

    for name in ("opencode", "opencode2", "opencode-cli"):
        found = shutil.which(name)
        requested = name == binary_name or (
            binary_name == "opencode2" and name == "opencode-cli"
        )
        if found:
            found_path = Path(found)
            search_dirs.append(found_path.parent)
            if requested:
                candidates.append(found_path)
        # On Windows PATHEXT sometimes hides the .cmd shim from which(); ask
        # for it explicitly as well.  On POSIX this simply returns None.
        found_cmd = shutil.which(f"{name}.cmd")
        if found_cmd:
            found_cmd_path = Path(found_cmd)
            search_dirs.append(found_cmd_path.parent)
            if requested:
                candidates.append(found_cmd_path)

    home = Path.home()
    search_dirs.append(home / ".opencode" / "bin")
    appdata = os.environ.get("APPDATA")
    if appdata:
        search_dirs.append(Path(appdata) / "npm")

    for directory in _dedupe_paths(search_dirs):
        candidates.append(directory / binary_name)
        if os.name == "nt":
            for suffix in _WINDOWS_SHIM_SUFFIXES:
                candidates.append(directory / f"{binary_name}{suffix}")

    if binary_name == "opencode2":
        # The desktop-bundled runner is the runtime OpenCode Desktop actually
        # launches, so prefer it over an older npm shim when both are present.
        candidates = [*_desktop_opencode_cli_candidates(), *candidates]

    expanded: list[Path] = []
    for candidate in candidates:
        expanded.extend(_windows_sibling_variants(candidate))
    return _dedupe_paths(expanded)


def _extract_version(text: str) -> str | None:
    match = re.search(r"(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)", text)
    return match.group(1) if match else None


def _parse_version_output(text: str) -> str | None:
    """Schema generation implied by ONE binary's version output.

    This is intentionally per-binary.  Combining the two binaries happens in
    :func:`detect_opencode_version`; a v1 ``opencode`` binary must never mask
    an installed v2 ``opencode2`` binary.
    """
    version = _extract_version(text)
    if version is None:
        return None
    major = int(version.split(".", 1)[0])
    return "v2" if major >= 2 else "v1"


def _run_version_probe(binary: Path, timeout: float) -> str | None:
    """Run ``<binary> --version`` in a daemon thread, tolerating every failure.

    The thread indirection mirrors how hung CLI probes are absorbed: a stuck
    binary can never block the caller beyond ``timeout``.
    """
    result: dict[str, str | None] = {"output": None}

    def _worker() -> None:
        try:
            proc = subprocess.run(  # noqa: S603 — fixed binary, no shell
                [str(binary), "--version"],
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
            result["output"] = (proc.stdout or "") + (proc.stderr or "")
        except (OSError, subprocess.SubprocessError):
            result["output"] = None

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()
    thread.join(timeout + 1.0)
    return result["output"]


def _probe_one_opencode_binary(binary_name: str, timeout: float) -> dict[str, Any] | None:
    for candidate in opencode_binary_candidates(binary_name):
        output = _run_version_probe(candidate, timeout)
        if output is None:
            continue
        schema = _parse_version_output(output)
        version = _extract_version(output)
        if schema and version:
            return {
                "version": version,
                "schema": schema,
                "path": str(candidate),
                "raw": output.strip()[:200],
            }
    return None


def probe_opencode_binaries(timeout: float = 4.0) -> dict[str, dict[str, Any] | None]:
    """Probe both opencode generations independently.

    Returns ``{"opencode": metadata|None, "opencode2": metadata|None}``.
    ``None`` means not installed or not probeable — never an error.
    """
    return {
        "opencode": _probe_one_opencode_binary("opencode", timeout),
        "opencode2": _probe_one_opencode_binary("opencode2", timeout),
    }


def probe_opencode_binary(timeout: float = 4.0) -> tuple[str | None, str | None]:
    """Backward-compatible v1-binary probe returning ``(schema, raw_output)``."""
    probed = _probe_one_opencode_binary("opencode", timeout)
    if not probed:
        return None, None
    return probed["schema"], probed["raw"]


def _omp_binary_candidates() -> list[Path]:
    candidates: list[Path] = []
    which = shutil.which("omp")
    if which:
        candidates.append(Path(which))
    localappdata = os.environ.get("LOCALAPPDATA")
    if localappdata:
        candidates.append(Path(localappdata) / "omp" / "omp.exe")
    return _dedupe_paths(candidates)


def _parse_omp_version(text: str) -> str | None:
    match = re.search(r"(\d+)\.(\d+)(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?", text)
    if match:
        return match.group(0)
    return None


def probe_omp_binary(timeout: float = 4.0) -> dict[str, Any]:
    """Detect the oh-my-pi binary and its version.

    Returns ``{"binaryPath": str|None, "version": str|None, "raw": str|None}``
    — ``None`` fields mean *unknown*, never a failure.
    """
    for candidate in _omp_binary_candidates():
        try:
            if not candidate.exists() and shutil.which("omp") is None:
                continue
        except OSError:
            continue
        output = _run_version_probe(candidate, timeout)
        if output is None:
            continue
        return {
            "binaryPath": str(candidate),
            "version": _parse_omp_version(output),  # None means version unknown
            "raw": output.strip()[:200],
        }
    return {"binaryPath": None, "version": None, "raw": None}


def detect_opencode_version(
    config_dir: Path | None = None,
    *,
    binary_probe: Any = None,
) -> dict[str, Any]:
    """Detect the OpenCode config schema version.

    Returns the backward-compatible ``version``/``source``/``raw`` keys plus a
    ``binaries`` object with independent metadata for ``opencode`` and
    ``opencode2``.  ``binary_probe`` is injectable for tests; both the legacy
    ``(schema, raw)`` tuple shape and the new binaries mapping are accepted.
    """
    config_dir = config_dir or default_opencode_dir()
    probe = binary_probe if binary_probe is not None else probe_opencode_binaries
    probe_result = probe()
    binaries: dict[str, Any] = {"opencode": None, "opencode2": None}
    legacy_schema: str | None = None
    legacy_raw: str | None = None
    if isinstance(probe_result, tuple):
        legacy_schema, legacy_raw = probe_result
    elif isinstance(probe_result, dict):
        binaries.update(probe_result)

    cli_json = config_dir / "cli.json"
    tui_json = config_dir / "tui.json"

    v2_binary = binaries.get("opencode2")
    if isinstance(v2_binary, dict) and v2_binary.get("version"):
        return {
            "version": "v2",
            "source": "binary",
            "binary": "opencode2",
            "raw": v2_binary.get("raw"),
            "binaries": binaries,
        }

    v1_binary = binaries.get("opencode")
    primary_schema = v1_binary.get("schema") if isinstance(v1_binary, dict) else legacy_schema
    primary_raw = v1_binary.get("raw") if isinstance(v1_binary, dict) else legacy_raw

    # cli.json is authoritative evidence of v2 even when the v1 binary is also
    # installed — v2 normalizes legacy config shapes and is the primary runtime.
    if cli_json.exists():
        return {"version": "v2", "source": "cli.json", "raw": primary_raw, "binaries": binaries}

    if primary_schema == "v2":
        return {"version": "v2", "source": "binary", "raw": primary_raw, "binaries": binaries}
    if primary_schema == "v1":
        return {"version": "v1", "source": "binary", "raw": primary_raw, "binaries": binaries}

    if tui_json.exists():
        return {"version": "v1", "source": "tui.json", "raw": None, "binaries": binaries}

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
            return {
                "version": "v2",
                "source": "config-providers-key",
                "raw": None,
                "binaries": binaries,
            }

    return {"version": "unknown", "source": "default", "raw": None, "binaries": binaries}


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


_DEBUG_DB_CACHE: dict[str, Path | None] = {}


def _parse_debug_db_output(output: str) -> Path | None:
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    for line in reversed(lines):
        # Accept either a bare path, "db: <path>", or a small JSON object.
        candidate = line
        if line.startswith("{"):
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            value = data.get("db") or data.get("database")
            if not isinstance(value, str) or not value.strip():
                continue
            candidate = value.strip()
        elif ":" in line and line.split(":", 1)[0].strip().lower() in {"db", "database"}:
            candidate = line.split(":", 1)[1].strip()
        candidate = candidate.strip().strip('"').strip("'")
        if candidate and not candidate.startswith(("opencode", "usage", "Usage")):
            return Path(candidate)
    return None


def probe_opencode_db_path(timeout: float = 4.0) -> Path | None:
    """Resolve opencode.db via ``opencode2 debug paths db`` (cached).

    The CLI is authoritative when present.  Any launch/parse failure simply
    returns ``None`` so filesystem fallbacks can be tried.
    """
    cache_key = os.environ.get("OPENCODE_CONFIG") or ""
    if cache_key in _DEBUG_DB_CACHE:
        return _DEBUG_DB_CACHE[cache_key]

    found: Path | None = None
    env = os.environ.copy()
    for candidate in opencode_binary_candidates("opencode2"):
        try:
            proc = subprocess.run(  # noqa: S603 — fixed binary, no shell
                [str(candidate), "debug", "paths", "db"],
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
                env=env,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if proc.returncode != 0:
            continue
        found = _parse_debug_db_output((proc.stdout or "") + "\n" + (proc.stderr or ""))
        if found is not None:
            break
    _DEBUG_DB_CACHE[cache_key] = found
    return found


def _credential_db_candidates() -> list[Path]:
    """Database locations in authoritative resolution order."""
    candidates: list[Path] = []
    override = os.environ.get("OPENCODE_DB")
    if override:
        candidates.append(Path(override))
    cli_path = probe_opencode_db_path()
    if cli_path is not None:
        candidates.append(cli_path)
    xdg_data = os.environ.get("XDG_DATA_HOME")
    if xdg_data:
        candidates.append(Path(xdg_data) / "opencode" / "opencode.db")
    candidates.append(Path.home() / ".local" / "share" / "opencode" / "opencode.db")
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(Path(appdata) / "opencode" / "opencode.db")
    return _dedupe_paths(candidates)


def _sqlite_ro_uri(path: Path) -> str:
    return path.absolute().as_uri() + "?mode=ro"


def _copy_db_triplet(db_path: Path, directory: Path) -> Path:
    """Copy db+wal+shm together preserving the basename for SQLite recovery."""
    target = directory / db_path.name
    shutil.copy2(db_path, target)
    for suffix in ("-wal", "-shm"):
        sidecar = db_path.with_name(db_path.name + suffix)
        if sidecar.exists():
            shutil.copy2(sidecar, target.with_name(target.name + suffix))
    return target


def _connect_credential_db(
    db_path: Path,
    *,
    force_copy: bool = False,
) -> tuple[sqlite3.Connection, tempfile.TemporaryDirectory[str] | None]:
    """Open the WAL database read-only, falling back to a db+wal+shm copy."""
    if not force_copy:
        try:
            conn = sqlite3.connect(_sqlite_ro_uri(db_path), uri=True, timeout=1.0)
            try:
                conn.execute("PRAGMA busy_timeout=1000")
                conn.execute("SELECT name FROM sqlite_master LIMIT 1").fetchall()
                return conn, None
            except sqlite3.Error:
                conn.close()
                raise
        except sqlite3.Error:
            pass
    tmpdir = tempfile.TemporaryDirectory(prefix="opencode-db-")
    try:
        copied = _copy_db_triplet(db_path, Path(tmpdir.name))
        conn = sqlite3.connect(_sqlite_ro_uri(copied), uri=True, timeout=1.0)
        conn.execute("PRAGMA busy_timeout=1000")
        return conn, tmpdir
    except Exception:
        tmpdir.cleanup()
        raise


def _quote_ident(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _pick_column(columns: set[str], names: tuple[str, ...]) -> str | None:
    by_lower = {column.lower(): column for column in columns}
    for name in names:
        found = by_lower.get(name.lower())
        if found is not None:
            return found
    return None


def _secret_from_value(value: Any) -> str | None:
    """Extract the key from the credential value; never exposed by callers."""
    if isinstance(value, (bytes, bytearray)):
        try:
            value = value.decode("utf-8")
        except UnicodeDecodeError:
            return None
    if not isinstance(value, str):
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return value
    if isinstance(parsed, dict):
        key = parsed.get("key")
        if isinstance(key, str):
            return key
        nested = parsed.get("value")
        if isinstance(nested, dict) and isinstance(nested.get("key"), str):
            return cast("str", nested["key"])
        return None
    if isinstance(parsed, str):
        return parsed
    return None


def _truthy(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def check_stitch_credential(token: str | None, *, _force_copy: bool = False) -> dict[str, Any]:
    """Compare the active stored v2 credential for integration ``stitch``.

    Resolution order: ``OPENCODE_DB`` → ``opencode2 debug paths db`` →
    XDG data → ``~/.local/share`` → legacy ``%APPDATA%``.  The database is
    opened through SQLite proper (read-only URI with a busy timeout); if the
    live WAL cannot be opened, db/wal/shm are copied together and the copy is
    read instead.  The database is never written and secret material is never
    returned or logged — only metadata appears in the result.
    """
    db_path = next((p for p in _credential_db_candidates() if p.exists()), None)
    if db_path is None:
        return {"status": "no-database", "detail": "opencode.db not found", "dbPath": None}

    conn: sqlite3.Connection | None = None
    tmpdir: tempfile.TemporaryDirectory[str] | None = None
    rows: list[dict[str, Any]] = []
    try:
        conn, tmpdir = _connect_credential_db(db_path, force_copy=_force_copy)
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        table = next((t for t in tables if "credential" in t.lower()), None)
        if table is None:
            return {
                "status": "unknown",
                "detail": "no credential table in opencode.db",
                "dbPath": str(db_path),
            }
        columns = {
            row[1] for row in conn.execute(f"PRAGMA table_info({_quote_ident(table)})").fetchall()
        }
        integration_col = _pick_column(
            columns, ("integration_id", "integrationID", "integration", "provider")
        )
        value_col = _pick_column(columns, ("value", "key", "api_key", "apiKey", "token", "secret"))
        if integration_col is None or value_col is None:
            return {
                "status": "unknown",
                "detail": "credential table shape not recognised",
                "dbPath": str(db_path),
            }

        id_col = _pick_column(columns, ("id", "credentialID", "credential_id"))
        label_col = _pick_column(columns, ("label", "name"))
        active_col = _pick_column(columns, ("active", "is_active", "enabled"))
        time_col = _pick_column(columns, ("time_created", "timeCreated", "created_at", "createdAt"))

        select_cols = [value_col]
        for optional in (id_col, label_col, active_col, time_col):
            if optional is not None and optional not in select_cols:
                select_cols.append(optional)
        order: list[str] = []
        if active_col is not None:
            order.append(f"{_quote_ident(active_col)} DESC")
        if time_col is not None:
            order.append(f"{_quote_ident(time_col)} DESC")
        if id_col is not None:
            order.append(f"{_quote_ident(id_col)} DESC")
        sql = (
            f"SELECT {', '.join(_quote_ident(c) for c in select_cols)} FROM {_quote_ident(table)} "
            f"WHERE {_quote_ident(integration_col)} = ?"
        )
        if order:
            sql += " ORDER BY " + ", ".join(order)
        cursor = conn.execute(sql, ("stitch",))
        selected = cursor.description or []
        names = [str(desc[0]) for desc in selected]
        for raw_row in cursor.fetchall():
            row = dict(zip(names, raw_row, strict=False))
            rows.append(row)
    except sqlite3.Error as exc:
        # A live WAL can open successfully yet fail when the credential table
        # is read.  Retry once against a db+wal+shm copy before degrading to
        # unknown; detection itself must never fail because of the probe.
        if not _force_copy:
            return check_stitch_credential(token, _force_copy=True)
        return {
            "status": "unknown",
            "detail": f"credential probe failed: {type(exc).__name__}: {str(exc)[:120]}",
            "dbPath": str(db_path),
        }
    except Exception as exc:  # never fail detection because of the probe
        return {
            "status": "unknown",
            "detail": f"credential probe failed: {type(exc).__name__}: {str(exc)[:120]}",
            "dbPath": str(db_path),
        }
    finally:
        if conn is not None:
            try:
                conn.close()
            except sqlite3.Error:
                pass
        if tmpdir is not None:
            tmpdir.cleanup()

    base: dict[str, Any] = {"dbPath": str(db_path), "count": len(rows)}
    if not rows:
        return {
            **base,
            "status": "no-credential",
            "detail": "no stitch credential stored",
        }

    first = rows[0]
    value_col = next(
        (c for c in first if c.lower() in {"value", "key", "api_key", "apikey", "token", "secret"}),
        None,
    )
    id_col = next((c for c in first if c.lower() in {"id", "credentialid", "credential_id"}), None)
    label_col = next((c for c in first if c.lower() in {"label", "name"}), None)
    active_col = next((c for c in first if c.lower() in {"active", "is_active", "enabled"}), None)
    metadata: dict[str, Any] = {
        **base,
        "credentialId": first.get(id_col) if id_col else None,
        "label": first.get(label_col) if label_col else None,
        "active": _truthy(first.get(active_col)) if active_col else None,
    }
    if token is None:
        return {
            **metadata,
            "status": "unknown",
            "detail": "no configured key to compare against",
        }
    active_secret = _secret_from_value(first.get(value_col)) if value_col else None
    if active_secret is not None and active_secret == token:
        return {
            **metadata,
            "status": "credential-match",
            "detail": "stored credential matches configured key",
        }
    return {
        **metadata,
        "status": "credential-mismatch",
        "detail": "stored credential differs from configured key — repair may be required",
    }
