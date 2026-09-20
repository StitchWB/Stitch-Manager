"""FreeModel bridge endpoint shim.

The bridge subprocess is owned by the ``stitch-freemodel`` service plugin
(out-of-process since the plugin migration).  The plugin records a running
bridge in ``<plugins-base>/data/plugins/stitch-freemodel/bridge_state.json``;
this module resolves the endpoint from that file so the sidecar-backed
``freemodel`` inference provider keeps working while the plugin runs.

The state file is HMAC-SHA256 signed with a 32-byte key in ``state.key``
next to it; unsigned or tampered state is rejected (a local writer with any
live pid must not redirect freemodel inference to an attacker port).

The historical sidecar name is kept verbatim — the plugin writes its state
under the same name and the supervisor/inference wiring keys on it.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import shutil
import sys
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

#: Historical sidecar name — do not rename (plugin state file + inference
#: provider registration both key on it).
SIDECAR_NAME = "freemodel_bridge"

_PLUGIN_ID = "stitch-freemodel"
_STATE_FILENAME = "bridge_state.json"
_STATE_KEY_FILENAME = "state.key"
_STATE_KEY_LEN = 32


# Canonical form + key layout are the contract with the plugin writer
# (plugins-src/stitch-freemodel/stitch_freemodel/service.py) — keep in sync.
def _verified_state(state_path: Path) -> dict[str, Any] | None:
    """State payload only if the ``hmac`` field verifies against state.key."""
    try:
        raw = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    try:
        key = (state_path.parent / _STATE_KEY_FILENAME).read_bytes()
    except OSError:
        return None
    presented = raw.get("hmac")
    if len(key) != _STATE_KEY_LEN or not isinstance(presented, str):
        return None
    payload = {k: v for k, v in raw.items() if k != "hmac"}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    expected = hmac.new(key, canonical, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, presented):
        return None
    return payload


def resolve_endpoint() -> str | None:
    """Endpoint of the plugin-managed bridge, or None when it is not running.

    Reads the plugin's state file, verifies its HMAC against ``state.key``,
    and checks the recorded pid is alive.  Pure local I/O — safe to call
    from the model-fetch hot path.
    """
    from autoreg.plugin.layout import _base_dir

    state_path = (
        _base_dir() / "data" / "plugins" / _PLUGIN_ID / _STATE_FILENAME
    )
    raw = _verified_state(state_path)
    if raw is None or raw.get("sidecar") != SIDECAR_NAME:
        return None
    try:
        port = int(raw["port"])
        pid = int(raw["pid"])
    except (ValueError, KeyError, TypeError):
        return None
    if port <= 0 or not _pid_alive(pid):
        return None
    return f"http://127.0.0.1:{port}"


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        # os.kill(pid, 0) is NOT a liveness probe on Windows (it calls
        # TerminateProcess for any signal) — use OpenProcess instead.
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000  # noqa: N806 (Win32 name)
        STILL_ACTIVE = 259  # noqa: N806 (Win32 name)

        handle = kernel32.OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION, False, pid
        )
        if not handle:
            return False
        try:
            exit_code = wintypes.DWORD()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return False
            return exit_code.value == STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def freemodel_child_env() -> dict[str, str]:
    """Extra env for the plugin child process.

    The plugin child runs with the supervisor's stripped PATH, so the
    ``claude`` CLI must be located HERE, in the core process, where the
    full user PATH is visible.  Candidate dirs mirror the plugin-side
    resolver (plugins-src/stitch-freemodel/stitch_freemodel/service.py)
    — keep both in sync.
    """
    dirs: list[str] = [d for d in os.environ.get("PATH", "").split(os.pathsep) if d]
    if os.name == "nt":
        appdata = os.environ.get("APPDATA", "")
        local = os.environ.get("LOCALAPPDATA", "")
        if appdata:
            dirs.append(os.path.join(appdata, "npm"))
        if local:
            dirs.append(os.path.join(local, "npm"))
        prefix = os.environ.get("NPM_CONFIG_PREFIX", "")
        if prefix:
            dirs.append(prefix)
    else:
        prefix = os.environ.get("NPM_CONFIG_PREFIX", "")
        if prefix:
            dirs.append(os.path.join(prefix, "bin"))
        dirs.extend(["/usr/local/bin", "/opt/homebrew/bin"])
    cmd = shutil.which("claude", path=os.pathsep.join(dirs))
    return {"FREEMODEL_CLAUDE_CMD": cmd} if cmd else {}
