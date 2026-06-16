"""MCP Bridge service — safety guards and journal.

Ports Rust ``commands/mcp_bridge.rs`` safety layer:
kill-switch, autonomy toggle, dry-run, critical action journaling.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _env_flag(key: str, default: bool) -> bool:
    raw = os.environ.get(key, "")
    if raw:
        return raw.strip().lower() in ("1", "true", "yes", "on")
    return default


def autonomy_enabled() -> bool:
    return _env_flag("STITCH_MCP_AUTONOMY_ENABLED", True)


def dry_run_enabled() -> bool:
    return _env_flag("STITCH_MCP_DRY_RUN", False)


def account_persist_allowed() -> bool:
    return _env_flag("STITCH_MCP_ALLOW_ACCOUNT_PERSIST", True)


def _app_data_dir() -> Path:
    home = Path.home()
    return home / ".stitch-manager"


def kill_switch_path() -> Path:
    raw = os.environ.get("STITCH_MCP_KILL_SWITCH_FILE", "")
    if raw and raw.strip():
        return Path(raw.strip())
    return _app_data_dir() / "mcp.kill-switch"


def critical_journal_path() -> Path:
    raw = os.environ.get("STITCH_MCP_CRITICAL_JOURNAL_PATH", "")
    if raw and raw.strip():
        return Path(raw.strip())
    return _app_data_dir() / "mcp-critical-actions.ndjson"


def ensure_write_allowed(action: str) -> None:
    """Raise if autonomy is disabled or kill-switch is active."""
    if not autonomy_enabled():
        raise RuntimeError(f"Autonomy mode is disabled; action blocked: {action}")
    ks = kill_switch_path()
    if ks.exists():
        raise RuntimeError(f"Autonomy disabled by kill-switch: {ks}")


def append_critical_journal(action: str, args: Any, result: Any) -> None:
    """Append a JSON line to the critical actions journal."""
    path = critical_journal_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "action": action,
            "dryRun": dry_run_enabled(),
            "args": args,
            "result": result,
        }
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, default=str) + "\n")
    except OSError as e:
        logger.warning("Failed to append critical journal: %s", e)


def scenario_roots() -> list[Path]:
    roots = [_app_data_dir() / "scenarios"]
    home = Path.home()
    roots.append(home / ".stitch-manager" / "scenarios")
    # Deduplicate
    seen: set[str] = set()
    unique: list[Path] = []
    for r in roots:
        key = str(r)
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique


def validate_scenario_path(raw: str) -> Path:
    """Validate and resolve a scenario file path within allowed roots."""
    raw = raw.strip()
    if not raw:
        raise ValueError("scenarioPath is required")

    path = Path(raw)
    if not path.is_absolute():
        path = Path.cwd() / path

    if path.suffix.lower() != ".json":
        raise ValueError("scenarioPath must be a .json file")

    # Resolve to canonical
    if path.exists():
        path = path.resolve()
    else:
        parent = path.parent
        if not parent.exists():
            raise ValueError(f"Parent directory does not exist: {parent}")
        path = parent.resolve() / path.name

    # Check under allowed roots
    canonical_roots = [r.resolve() if r.exists() else r for r in scenario_roots()]
    if not any(str(path).startswith(str(root)) for root in canonical_roots):
        raise ValueError(f"Access denied: path outside known scenario roots: {path}")

    return path
