"""Shared contract for plugin-owned bridge state files.

A service plugin that owns a local bridge process publishes its endpoint in
``<plugins-base>/data/plugins/<plugin-id>/bridge_state.json``, signed with
``state.key`` (HMAC-SHA256 over the canonical JSON with the ``hmac`` field
removed).  The hub trusts only verified state, so a local writer with any live
PID cannot redirect inference to an attacker port.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

STATE_FILENAME = "bridge_state.json"
STATE_KEY_FILENAME = "state.key"
STATE_KEY_LEN = 32


def verified_state(state_path: Path) -> dict[str, Any] | None:
    """State payload only if the ``hmac`` field verifies against state.key."""
    try:
        raw = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    try:
        key = (state_path.parent / STATE_KEY_FILENAME).read_bytes()
    except OSError:
        return None
    presented = raw.get("hmac")
    if len(key) != STATE_KEY_LEN or not isinstance(presented, str):
        return None
    payload = {k: v for k, v in raw.items() if k != "hmac"}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    expected = hmac.new(key, canonical, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, presented):
        return None
    return payload


def pid_alive(pid: int) -> bool:
    """Cross-platform process liveness probe."""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        # os.kill(pid, 0) is not a liveness probe on Windows.
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32
        process_query_limited_information = 0x1000
        still_active = 259
        handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
        if not handle:
            return False
        try:
            exit_code = wintypes.DWORD()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return False
            return exit_code.value == still_active
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def resolve_plugin_bridge(plugin_id: str, sidecar_name: str) -> str | None:
    """Endpoint of a plugin-owned bridge from its verified state file.

    Pure local I/O — safe to call from the model-fetch hot path.  Returns
    ``None`` when the state is missing/untrusted, the sidecar name differs, or
    the recorded process is gone.
    """
    from autoreg.plugin.layout import _base_dir

    state_path = _base_dir() / "data" / "plugins" / plugin_id / STATE_FILENAME
    raw = verified_state(state_path)
    if raw is None or raw.get("sidecar") != sidecar_name:
        return None
    try:
        port = int(raw["port"])
        pid = int(raw["pid"])
    except (ValueError, KeyError, TypeError):
        return None
    if port <= 0 or not pid_alive(pid):
        return None
    return f"http://127.0.0.1:{port}"
