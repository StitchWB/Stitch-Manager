"""Persist the pywebview window size across launches.

State file: ``~/.stitch-manager/window-state.json`` (kept separate from
``settings.json`` so window geometry never crosses app-config writes).

pywebview fires ``window.events.closing`` synchronously in the GUI thread
before the form actually closes (``should_lock=True``), and ``window.width``
/ ``window.height`` return the live size at that moment — so one handler on
``closing`` is enough; no need to track every ``resized`` tick.

ponytail: width/height only. If the user maximizes and closes, the saved
size is the maximized pixel size, restored as a normal (non-maximized)
window next launch. Add maximized/restored-state tracking if that bites.
"""
from __future__ import annotations

import json
import sys

from autoreg.core.paths import get_paths

_STATE_FILE = get_paths().user_data_dir / "window-state.json"
_DEFAULT_SIZE: tuple[int, int] = (1280, 800)
_MIN_SIZE: tuple[int, int] = (320, 240)  # sanity floor; ignore saved values below this


def load_size() -> tuple[int, int]:
    """Return the last persisted ``(width, height)``, or the default."""
    try:
        data = json.loads(_STATE_FILE.read_text(encoding="utf-8"))
        w, h = int(data["width"]), int(data["height"])
    except (FileNotFoundError, ValueError, TypeError, KeyError, OSError):
        return _DEFAULT_SIZE
    if w < _MIN_SIZE[0] or h < _MIN_SIZE[1]:
        return _DEFAULT_SIZE
    return w, h


def save_size(width: int, height: int) -> None:
    """Persist window size to disk."""
    try:
        _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _STATE_FILE.write_text(
            json.dumps({"width": int(width), "height": int(height)}),
            encoding="utf-8",
        )
    except OSError as exc:
        print(f"[window_state] failed to save size: {exc}", file=sys.stderr)


def attach(window) -> None:
    """Persist the window's size to disk when it closes."""
    def on_closing() -> None:
        save_size(window.width, window.height)

    window.events.closing += on_closing
