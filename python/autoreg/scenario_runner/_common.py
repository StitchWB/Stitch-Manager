"""Shared NDJSON protocol emitters, overlay runtime loader, and small arg/setup helpers
used by both the record and replay engines."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from ._overlay_shim_js import OVERLAY_SHIM_JS


def _now_iso() -> str:
    return (
        time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int((time.time() % 1) * 1000):03d}Z"
    )


def _emit(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(level: str, message: str, *, step: str | None = None, data: Any | None = None) -> None:
    _emit(
        {
            "type": "log",
            "level": level,
            "message": message,
            "step": step,
            "data": data,
        }
    )


def _event(name: str, payload: dict[str, Any] | None = None) -> None:
    _emit(
        {
            "type": "event",
            "level": "info",
            "message": name,
            "data": payload or {},
        }
    )


def _result(
    ok: bool, data: dict[str, Any] | None = None, error: dict[str, Any] | None = None
) -> None:
    _emit(
        {
            "type": "result",
            "ok": ok,
            "message": "ok" if ok else "error",
            "data": data or {},
            "error": error,
        }
    )


_SHARED_OVERLAY_RUNTIME_PATH = (
    Path(__file__).resolve().parents[3] / "extension" / "stitch-toolkit" / "overlay_runtime.js"
)


def _overlay_runtime_shim_script() -> str:
    return OVERLAY_SHIM_JS


def _load_shared_overlay_runtime_script() -> str:
    try:
        source = _SHARED_OVERLAY_RUNTIME_PATH.read_text(encoding="utf-8")
        if source.strip():
            return source
    except Exception as e:
        _log(
            "warn",
            f"Shared overlay runtime unavailable, using shim: {e}",
            step="overlay",
        )
    return _overlay_runtime_shim_script()


def pin_playwright_browsers_path(paths: Any) -> None:
    # PLAYWRIGHT_BROWSERS_PATH must stay pinned so install_browser_runtime.py finds the browsers.
    try:
        pw_cache = paths.cache_dir / "playwright-browsers"
        pw_cache.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(pw_cache))
    except Exception:
        pass


def parse_config_json(args: Any) -> dict[str, Any]:
    config: dict[str, Any] = {"timezone_id": "Auto", "geolocation": "Auto"}
    if args.config_json and args.config_json.strip():
        try:
            loaded = json.loads(args.config_json)
            if isinstance(loaded, dict):
                config.update(loaded)
        except Exception:
            _log("warn", "Invalid --config-json, ignoring", step="init")
    return config


def build_runtime_proxy_map(config: dict[str, Any]) -> dict[str, str]:
    return {
        str(k): str(v)
        for k, v in dict(config.get("runtime_proxy_map") or {}).items()
        if isinstance(k, str) and isinstance(v, str) and k.strip() and v.strip()
    }


def resolve_out_dir(args: Any, paths: Any) -> Path:
    out_dir = (
        Path(args.out).expanduser().resolve() if args.out else (paths.user_data_dir / "scenarios")
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir
