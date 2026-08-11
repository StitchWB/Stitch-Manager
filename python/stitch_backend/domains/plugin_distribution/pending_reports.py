"""Pending failure-report store (plan §3.4, §7 Phase 4).

Stores scrubbed report bundles as ``<uuid>.json`` files in
``<data_dir>/pending_reports/``.  The UI lists, previews, sends, and
discards them via backend commands (see :mod:`.commands`).

All operations are robust to a missing directory or corrupt files —
telemetry must never break a run or startup.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from .config import data_dir

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

_DIR_NAME = "pending_reports"
# Report ids are uuid4().hex — 32 lowercase hex chars.  Enforce the same
# shape on load/delete to prevent path-traversal via crafted ids.
_ID_RE = re.compile(r"^[a-f0-9]{1,64}$")
_ERROR_PREVIEW_LIMIT = 200


def _pending_dir() -> Path:
    """Return the pending-reports directory (created on first write)."""
    return data_dir() / _DIR_NAME


def _safe_path(report_id: str) -> Path | None:
    """Return the file path for ``report_id``, or None if the id is invalid."""
    if not report_id or not _ID_RE.match(report_id):
        return None
    return _pending_dir() / f"{report_id}.json"


def save_pending_report(bundle: dict[str, Any]) -> str:
    """Write a scrubbed bundle as ``<uuid>.json``. Returns the report id.

    The wrapper schema is ``{"id": str, "created_at": ISO-8601 UTC,
    "bundle": {...}}``.  Never raises — a write failure is logged and an
    empty string is returned so the caller (telemetry hook) is unaffected.
    """
    report_id = uuid.uuid4().hex
    wrapper: dict[str, Any] = {
        "id": report_id,
        "created_at": datetime.now(UTC).isoformat(),
        "bundle": bundle,
    }
    try:
        path = _pending_dir() / f"{report_id}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(wrapper, indent=2) + "\n", encoding="utf-8",
        )
    except OSError as exc:
        logger.warning("save_pending_report: write failed: %s", exc)
        return ""
    return report_id


def list_pending() -> list[dict[str, Any]]:
    """Return metadata for all pending reports (newest first).

    Corrupt files are skipped with a warning. Never raises.
    """
    out: list[dict[str, Any]] = []
    directory = _pending_dir()
    if not directory.is_dir():
        return out
    for path in directory.iterdir():
        if not path.is_file() or path.suffix != ".json":
            continue
        try:
            wrapper = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            logger.warning("list_pending: skipping corrupt %s: %s", path.name, exc)
            continue
        bundle = wrapper.get("bundle", {})
        out.append({
            "id": wrapper.get("id", path.stem),
            "plugin_id": bundle.get("plugin_id", ""),
            "version": bundle.get("version", ""),
            "step": bundle.get("step", ""),
            "step_kind": bundle.get("step_kind", ""),
            "created_at": wrapper.get("created_at", ""),
            "scrubbed": bundle.get("scrubbed", False),
            "size_bytes": path.stat().st_size,
            "error_preview": _truncate(bundle.get("error", "")),
        })
    out.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return out


def load_pending(report_id: str) -> dict[str, Any] | None:
    """Return the full wrapper dict for ``report_id``, or None if missing."""
    path = _safe_path(report_id)
    if path is None or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning("load_pending: corrupt %s: %s", path.name, exc)
        return None
    if not isinstance(data, dict):
        logger.warning("load_pending: not a dict in %s", path.name)
        return None
    return data


def delete_pending(report_id: str) -> bool:
    """Delete a pending report. Returns True if deleted, False if missing."""
    path = _safe_path(report_id)
    if path is None or not path.is_file():
        return False
    try:
        path.unlink()
    except OSError as exc:
        logger.warning("delete_pending: %s: %s", path.name, exc)
        return False
    return True


def _truncate(text: str) -> str:
    """Truncate text to at most ``_ERROR_PREVIEW_LIMIT`` characters."""
    return text[:_ERROR_PREVIEW_LIMIT]
