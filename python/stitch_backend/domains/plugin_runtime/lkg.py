"""LKG (last-known-good) support for kind=service plugins (todo 23).

Tracks consecutive crash counts per plugin id, resolves the previous
version directory from the plugins cache (``install.py`` retains the 2
newest versions precisely so a last-known-good exists), records
rollback/degraded events, and saves crash-loop telemetry through the
existing ``pending_reports`` store with the ``failure_hook`` consent
gate (no new telemetry infrastructure).

Zone-2: depends on ``autoreg.plugin`` (layout, manifest) and
``plugin_distribution`` (failure_hook consent, pending_reports).
"""

from __future__ import annotations

import logging
from collections import deque
from pathlib import Path
from typing import Any

from autoreg.plugin.layout import plugins_cache_dir
from autoreg.plugin.manifest import parse_semver

# Consent gate is called qualified (failure_hook._read_consent) so test
# monkeypatches on the failure_hook module take effect here too.
from stitch_backend.domains.plugin_distribution import failure_hook
from stitch_backend.domains.plugin_distribution.pending_reports import (
    save_pending_report,
)

logger = logging.getLogger(__name__)

#: Consecutive crashes that constitute a crash loop: the host restarts
#: once, so a death after the restart means 2 consecutive crashes.
CRASH_LOOP_THRESHOLD = 2

#: Last stderr lines included in a crash report (from the host ring buffer).
_STDERR_LINES_PER_REPORT = 20

#: Bound the in-memory event journal (observability only).
_MAX_EVENTS = 100

#: Consecutive crash count per plugin id (reset on healthy start/rollback).
_crash_counts: dict[str, int] = {}

#: Rollback / degraded event journal for observability (todo 25 monitoring).
_events: deque[dict[str, Any]] = deque(maxlen=_MAX_EVENTS)


def record_crash(plugin_id: str) -> int:
    """Increment and return the consecutive crash count for ``plugin_id``."""
    count = _crash_counts.get(plugin_id, 0) + 1
    _crash_counts[plugin_id] = count
    return count


def reset_crashes(plugin_id: str) -> None:
    """Reset the consecutive crash count (healthy start / rollback)."""
    _crash_counts.pop(plugin_id, None)


def crash_count(plugin_id: str) -> int:
    """Return the current consecutive crash count (0 when never crashed)."""
    return _crash_counts.get(plugin_id, 0)


def record_event(event: dict[str, Any]) -> None:
    """Append a rollback/degraded event to the in-memory journal."""
    _events.append(event)


def rollback_events() -> list[dict[str, Any]]:
    """Return a copy of the rollback/degraded event journal."""
    return list(_events)


def previous_version_dir(
    plugin_id: str, current_version: str | None
) -> Path | None:
    """Return the newest cache version dir strictly older than ``current_version``.

    Scans ``plugins/{plugin_id}/`` (the server cache; ``install.py`` keeps
    the 2 newest versions).  Returns ``None`` when there is no previous
    version to roll back to — the caller surfaces a degraded state.
    """
    plugin_root = plugins_cache_dir() / plugin_id
    if not plugin_root.is_dir():
        return None
    try:
        current = parse_semver(current_version) if current_version else None
    except ValueError:
        current = None
    best: tuple[tuple[int, int, int], Path] | None = None
    for entry in plugin_root.iterdir():
        if not entry.is_dir() or entry.name == ".staging":
            continue
        try:
            ver = parse_semver(entry.name)
        except ValueError:
            continue
        if current is not None and ver >= current:
            continue
        if best is None or ver > best[0]:
            best = (ver, entry)
    return best[1] if best else None


async def maybe_save_crash_report(
    plugin_id: str, version: str, stderr_lines: list[str],
) -> str:
    """Save a crash-loop report via ``pending_reports`` (failure_hook pattern).

    Bundle carries plugin id, version, and the last stderr lines from the
    host log buffer.  Consent-gated by ``telemetry_consent`` (reuses
    ``failure_hook._read_consent``).  Never raises — telemetry must not
    break the runtime.  Returns the report id ("" when not saved).
    """
    try:
        if not await failure_hook._read_consent():
            return ""
        bundle = {
            "plugin_id": plugin_id,
            "version": version,
            "step": "crash_loop",
            "step_kind": "service_host",
            "error": "\n".join(stderr_lines[-_STDERR_LINES_PER_REPORT:]),
            "scrubbed": True,
        }
        report_id = save_pending_report(bundle)
        if report_id:
            logger.info(
                "Pending crash report saved: %s (plugin=%s version=%s)",
                report_id, plugin_id, version,
            )
        return report_id
    except Exception as exc:  # noqa: BLE001 — telemetry must never break runtime
        logger.warning("maybe_save_crash_report failed: %s", exc)
        return ""


__all__ = [
    "CRASH_LOOP_THRESHOLD",
    "record_crash",
    "reset_crashes",
    "crash_count",
    "record_event",
    "rollback_events",
    "previous_version_dir",
    "maybe_save_crash_report",
]
