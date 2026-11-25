"""Pure file layer for opencode / OMO config management.

No DB, no network, no global state: every path is a parameter so the layer
is testable against tmp_path without touching the real user config.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

MASK = "********"

OMO_SECTION = "[opencode]"

# OMO builtin agents: their omo.jsonc value wins over opencode's agent.<name>.model.
BUILTIN_AGENTS = frozenset({
    "sisyphus",
    "hephaestus",
    "prometheus",
    "atlas",
    "sisyphus-junior",
    "oracle",
    "metis",
    "momus",
    "explore",
    "librarian",
    "multimodal-looker",
})


def default_opencode_path() -> Path:
    override = os.environ.get("OPENCODE_CONFIG")
    if override:
        return Path(override)
    return Path.home() / ".config" / "opencode" / "opencode.json"


def default_omo_path() -> Path:
    override = os.environ.get("OMO_CONFIG")
    if override:
        return Path(override)
    return Path.home() / ".omo" / "omo.jsonc"


def _strip_comments(text: str) -> str:
    out: list[str] = []
    i = 0
    n = len(text)
    in_string = False
    while i < n:
        ch = text[i]
        if in_string:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            i += 2
            while i < n and text[i] not in "\r\n":
                i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _strip_trailing_commas(text: str) -> str:
    out: list[str] = []
    i = 0
    n = len(text)
    in_string = False
    while i < n:
        ch = text[i]
        if in_string:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue
        if ch == ",":
            j = i + 1
            while j < n and text[j] in " \t\r\n":
                j += 1
            if j < n and text[j] in "}]":
                i += 1
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def parse_jsonc(text: str) -> Any:
    return json.loads(_strip_trailing_commas(_strip_comments(text)))


@dataclass(frozen=True)
class Snapshot:
    path: Path
    exists: bool
    data: dict[str, Any]
    sha256: str | None
    is_jsonc: bool


def read_snapshot(path: str | Path) -> Snapshot:
    resolved = Path(path)
    is_jsonc = resolved.suffix.lower() == ".jsonc"
    if not resolved.exists():
        return Snapshot(path=resolved, exists=False, data={}, sha256=None, is_jsonc=is_jsonc)
    raw = resolved.read_bytes()
    text = raw.decode("utf-8-sig")
    parsed = parse_jsonc(text) if is_jsonc else json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError(f"config root is not a JSON object: {resolved}")
    return Snapshot(
        path=resolved,
        exists=True,
        data=parsed,
        sha256=hashlib.sha256(raw).hexdigest(),
        is_jsonc=is_jsonc,
    )


def _backup_path(path: Path) -> Path:
    # Unique suffix: 1s-resolution timestamps collide when several files are
    # backed up inside the same second (multi-file apply), so add a uuid tail.
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return path.with_name(f"{path.name}.bak-{stamp}-{uuid.uuid4().hex[:8]}")


def sha256_file(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _replace_with_retry(tmp_name: str, target: Path, attempts: int = 3) -> None:
    """os.replace with a small backoff for transient Windows file locks."""
    delay = 0.05
    last_exc: OSError | None = None
    for attempt in range(attempts):
        try:
            os.replace(tmp_name, target)
            return
        except OSError as exc:  # PermissionError on Windows when a reader holds a lock
            last_exc = exc
            if attempt < attempts - 1:
                time.sleep(delay)
                delay *= 2
    assert last_exc is not None
    raise last_exc


def write_text_atomic(
    path: str | Path,
    text: str,
    *,
    expected_sha256: str | None,
    encoding: str = "utf-8",
) -> dict[str, Any]:
    """Write *text* to *path* atomically with sha256 conflict protection.

    Protocol: when the file exists, ``expected_sha256`` must match the current
    on-disk hash (``None`` is never accepted for an existing file — callers
    must snapshot first); when the file does not exist, ``expected_sha256``
    must be ``None``.  A mismatch returns ``{"ok": False, "error": "conflict"}``
    and nothing is written.

    The previous content is copied to a uniquely-named sibling backup before
    replacement.  NOTE: backups may contain secrets (API tokens) — never log
    their contents.

    The write itself is flush+fsync into a temp file in the same directory
    followed by ``os.replace`` (with a short retry loop for transient Windows
    locks).  This is atomic for a single file only — multi-file applies are
    best-effort, never fully atomic.
    """
    resolved = Path(path)
    if resolved.exists():
        current = sha256_file(resolved)
        if expected_sha256 is None or current != expected_sha256:
            return {"ok": False, "error": "conflict", "path": str(resolved)}
        backup = _backup_path(resolved)
        backup.write_bytes(resolved.read_bytes())
        backup_path: str | None = str(backup)
    elif expected_sha256 is not None:
        return {"ok": False, "error": "conflict", "path": str(resolved)}
    else:
        backup_path = None

    resolved.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(resolved.parent), prefix=f"{resolved.name}.", suffix=".tmp"
    )
    try:
        # newline="" disables text-mode translation: bytes on disk match the
        # exact text we were given on every platform (sha256-stable).
        with os.fdopen(fd, "w", encoding=encoding, newline="") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        _replace_with_retry(tmp_name, resolved)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    return {
        "ok": True,
        "path": str(resolved),
        "backupPath": backup_path,
        "commentsMayBeDropped": resolved.suffix.lower() == ".jsonc",
    }


def write_config(
    path: str | Path, data: dict[str, Any], *, expected_sha256: str | None
) -> dict[str, Any]:
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    return write_text_atomic(path, text, expected_sha256=expected_sha256)


def normalize_opencode(snapshot: Snapshot) -> dict[str, Any]:
    data = snapshot.data
    providers: list[dict[str, Any]] = []
    providers_raw = data.get("provider")
    if isinstance(providers_raw, dict):
        for pid, pcfg in providers_raw.items():
            if not isinstance(pcfg, dict):
                continue
            options = pcfg.get("options")
            options = options if isinstance(options, dict) else {}
            models = pcfg.get("models")
            model_ids = list(models.keys()) if isinstance(models, dict) else []
            providers.append({
                "id": pid,
                "name": pcfg.get("name"),
                "npm": pcfg.get("npm"),
                "baseURL": options.get("baseURL"),
                "apiKey": MASK if options.get("apiKey") else None,
                "modelCount": len(model_ids),
                "models": model_ids,
            })
    agents: dict[str, Any] = {}
    agents_raw = data.get("agent")
    if isinstance(agents_raw, dict):
        for name, acfg in agents_raw.items():
            agents[name] = acfg.get("model") if isinstance(acfg, dict) else None
    return {
        "path": str(snapshot.path),
        "exists": snapshot.exists,
        "model": data.get("model"),
        "providers": providers,
        "agents": agents,
    }


def normalize_omo(snapshot: Snapshot) -> dict[str, Any]:
    section = snapshot.data.get(OMO_SECTION)
    section = section if isinstance(section, dict) else {}
    agents: dict[str, Any] = {}
    agents_raw = section.get("agents")
    if isinstance(agents_raw, dict):
        for name, acfg in agents_raw.items():
            if not isinstance(acfg, dict):
                continue
            agents[name] = {
                "model": acfg.get("model"),
                "models": acfg.get("models"),
                "fallbackModels": acfg.get("fallback_models"),
            }
    categories: dict[str, Any] = {}
    categories_raw = section.get("categories")
    if isinstance(categories_raw, dict):
        for name, ccfg in categories_raw.items():
            if not isinstance(ccfg, dict):
                continue
            categories[name] = {
                "model": ccfg.get("model"),
                "fallbackModels": ccfg.get("fallback_models"),
            }
    return {
        "path": str(snapshot.path),
        "exists": snapshot.exists,
        "agents": agents,
        "categories": categories,
        "runtimeFallback": section.get("runtime_fallback"),
    }


def _provider_entry(snapshot: Snapshot, provider_id: str) -> dict[str, Any]:
    providers = snapshot.data.get("provider")
    entry = providers.get(provider_id) if isinstance(providers, dict) else None
    return entry if isinstance(entry, dict) else {}


def resolve_provider_endpoint(
    snapshot: Snapshot, provider_id: str
) -> tuple[str | None, str | None]:
    """Return ``(baseURL, apiKey)`` for a provider in the opencode config."""
    options = _provider_entry(snapshot, provider_id).get("options")
    options = options if isinstance(options, dict) else {}
    return options.get("baseURL"), options.get("apiKey")


def provider_model_ids(snapshot: Snapshot, provider_id: str) -> list[str]:
    """Return the configured model ids of a provider (empty when absent)."""
    models = _provider_entry(snapshot, provider_id).get("models")
    return list(models.keys()) if isinstance(models, dict) else []


def restore_from_backup(
    path: str | Path, backup_path: str | Path, *, expected_sha256: str | None
) -> dict[str, Any]:
    """Copy a backup over the live config, keeping a safety copy of the current file."""
    resolved = Path(path)
    backup = Path(backup_path)
    if not backup.exists():
        return {"ok": False, "error": "backup not found", "path": str(resolved)}

    raw = backup.read_bytes()
    is_jsonc = resolved.suffix.lower() == ".jsonc" or backup.suffix.lower() == ".jsonc"
    text = raw.decode("utf-8-sig")
    parsed = parse_jsonc(text) if is_jsonc else json.loads(text)
    if not isinstance(parsed, dict):
        return {"ok": False, "error": "backup root is not a JSON object", "path": str(resolved)}

    if resolved.exists():
        if expected_sha256 is not None:
            current = hashlib.sha256(resolved.read_bytes()).hexdigest()
            if current != expected_sha256:
                return {"ok": False, "error": "conflict", "path": str(resolved)}
        safety = _backup_path(resolved)
        safety.write_bytes(resolved.read_bytes())
        safety_path: str | None = str(safety)
    elif expected_sha256 is not None:
        return {"ok": False, "error": "conflict", "path": str(resolved)}
    else:
        safety_path = None

    resolved.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(resolved.parent), prefix=f"{resolved.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        _replace_with_retry(tmp_name, resolved)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    return {
        "ok": True,
        "path": str(resolved),
        "restoredFrom": str(backup),
        "safetyBackupPath": safety_path,
    }
