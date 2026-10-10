"""Child stderr pumping into the host's log ring buffer + activity-log store.

Level heuristic: a stderr line containing "error" or "traceback"
(case-insensitive) is ingested as ``error``, everything else as ``info``.
"""

from __future__ import annotations

import collections
import threading
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from stitch_backend.core.event_bus import event_bus

if TYPE_CHECKING:
    from stitch_backend.domains.plugin_runtime.host import ServicePluginHost

#: Per-plugin ingestion budget before lines are dropped with one marker.
RATE_LIMIT_LINES = 200
RATE_LIMIT_WINDOW_S = 60.0
TRUNCATED_MESSAGE = "plugin stderr rate limit exceeded, logs truncated"

_rate_lock = threading.Lock()
_rate_windows: dict[str, _RateWindow] = {}


@dataclass(slots=True)
class _RateWindow:
    start: float
    admitted: int = 0
    marker_emitted: bool = False


def reset_rate_limits() -> None:
    """Clear per-plugin ingestion rate-limit state (test isolation)."""
    with _rate_lock:
        _rate_windows.clear()


def _classify(line: str) -> str:
    lowered = line.lower()
    if "traceback" in lowered or "error" in lowered:
        return "error"
    return "info"


def _admit(plugin_id: str, line: str) -> tuple[str, str] | None:
    now = time.monotonic()
    with _rate_lock:
        window = _rate_windows.get(plugin_id)
        if window is None or now - window.start >= RATE_LIMIT_WINDOW_S:
            window = _RateWindow(start=now)
            _rate_windows[plugin_id] = window
        if window.admitted >= RATE_LIMIT_LINES:
            if window.marker_emitted:
                return None
            window.marker_emitted = True
            return ("warn", TRUNCATED_MESSAGE)
        window.admitted += 1
        return (_classify(line), line)


class LogBuffer(collections.deque[str]):
    """Stderr ring buffer that also emits each line for activity-log ingestion."""

    def __init__(self, plugin_id: str, maxlen: int = 1000) -> None:
        super().__init__(maxlen=maxlen)
        self._plugin_id = plugin_id

    def append(self, line: str) -> None:
        super().append(line)
        if not line:
            return
        admitted = _admit(self._plugin_id, line)
        if admitted is not None:
            level, message = admitted
            event_bus.emit_sync(
                "plugin.stderr",
                {"plugin_id": self._plugin_id, "level": level, "message": message},
            )


def stderr_reader(host: ServicePluginHost) -> None:
    """Read child stderr line-by-line into the ring buffer."""
    proc = host.rpc._proc
    if proc is None or proc.stderr is None:
        return
    stream = proc.stderr
    try:
        for raw in iter(stream.readline, b""):
            host._log_buffer.append(
                raw.decode("utf-8", errors="replace").rstrip("\r\n")
            )
    except Exception:  # noqa: BLE001 — pipe closed / process dead
        pass
