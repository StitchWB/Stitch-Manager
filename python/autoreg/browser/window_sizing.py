"""Browser window sizing: screen detection, fit/clamp helpers, config resolution."""

from __future__ import annotations

import os
import re
from typing import Any

DEFAULT_BROWSER_WINDOW = (1920, 1080)
MIN_BROWSER_WINDOW = (800, 600)
MAX_BROWSER_WINDOW = (7680, 4320)
FIT_SCREEN_MARGIN = (16, 88)


def _to_positive_int(value: Any) -> int | None:
    try:
        parsed = int(float(value))
    except Exception:
        return None
    return parsed if parsed > 0 else None


def _normalize_window_tuple(value: Any) -> tuple[int, int] | None:
    if isinstance(value, (tuple, list)) and len(value) >= 2:
        width = _to_positive_int(value[0])
        height = _to_positive_int(value[1])
        if width and height:
            return width, height

    if isinstance(value, dict):
        width = _to_positive_int(value.get("width"))
        height = _to_positive_int(value.get("height"))
        if width and height:
            return width, height

    if isinstance(value, str):
        raw = value.strip().lower()
        match = re.match(r"^\s*(\d{3,5})\s*[x,]\s*(\d{3,5})\s*$", raw)
        if match:
            width = _to_positive_int(match.group(1))
            height = _to_positive_int(match.group(2))
            if width and height:
                return width, height

    return None


def _detect_primary_screen_size() -> tuple[int, int] | None:
    # 1) explicit env override for CI/debug
    env_w = _to_positive_int(os.environ.get("STITCH_SCREEN_WIDTH"))
    env_h = _to_positive_int(os.environ.get("STITCH_SCREEN_HEIGHT"))
    if env_w and env_h:
        return env_w, env_h

    # 2) Windows-native metrics (most reliable for this app's primary target)
    try:
        import ctypes

        user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        width = _to_positive_int(user32.GetSystemMetrics(0))
        height = _to_positive_int(user32.GetSystemMetrics(1))
        if width and height:
            return width, height
    except Exception:
        pass

    # 3) generic fallback via tkinter
    try:
        import tkinter as tk

        root = tk.Tk()
        root.withdraw()
        width = _to_positive_int(root.winfo_screenwidth())
        height = _to_positive_int(root.winfo_screenheight())
        root.destroy()
        if width and height:
            return width, height
    except Exception:
        pass

    return None


def _fit_window_to_screen(screen_size: tuple[int, int]) -> tuple[int, int]:
    screen_w, screen_h = screen_size
    margin_w, margin_h = FIT_SCREEN_MARGIN
    width = max(MIN_BROWSER_WINDOW[0], screen_w - margin_w)
    height = max(MIN_BROWSER_WINDOW[1], screen_h - margin_h)
    return width, height


def _clamp_window_size(
    size: tuple[int, int],
    *,
    screen_size: tuple[int, int] | None,
) -> tuple[int, int]:
    width = max(MIN_BROWSER_WINDOW[0], min(MAX_BROWSER_WINDOW[0], int(size[0])))
    height = max(MIN_BROWSER_WINDOW[1], min(MAX_BROWSER_WINDOW[1], int(size[1])))

    if screen_size is not None:
        screen_w = max(MIN_BROWSER_WINDOW[0], int(screen_size[0]))
        screen_h = max(MIN_BROWSER_WINDOW[1], int(screen_size[1]))
        width = min(width, screen_w)
        height = min(height, screen_h)

    return width, height


def _resolve_browser_window(
    config: dict[str, Any],
    *,
    current_window: Any,
) -> tuple[tuple[int, int], bool]:
    raw = config.get("browser_window")
    current_normalized = _normalize_window_tuple(current_window)
    screen_size = _detect_primary_screen_size()
    fit_size = _fit_window_to_screen(screen_size) if screen_size is not None else None

    mode = "fit-screen"
    maximize_on_start = True  # default to maximized for best UX
    explicit_size: tuple[int, int] | None = None

    if isinstance(raw, dict):
        raw_mode = str(raw.get("mode") or "").strip().lower()
        if raw_mode in ("auto", "fit-screen", "fixed"):
            mode = raw_mode

        if "maximize_on_start" in raw:
            maximize_on_start = bool(raw.get("maximize_on_start"))
        elif "maximizeOnStart" in raw:
            maximize_on_start = bool(raw.get("maximizeOnStart"))

        width = _to_positive_int(raw.get("width"))
        height = _to_positive_int(raw.get("height"))
        if width and height:
            explicit_size = (width, height)

    if mode == "fixed":
        size = explicit_size or current_normalized or DEFAULT_BROWSER_WINDOW
    elif mode == "auto":
        size = current_normalized or fit_size or DEFAULT_BROWSER_WINDOW
    else:
        size = fit_size or current_normalized or DEFAULT_BROWSER_WINDOW

    if maximize_on_start and fit_size is not None:
        size = fit_size

    return _clamp_window_size(size, screen_size=screen_size), maximize_on_start
