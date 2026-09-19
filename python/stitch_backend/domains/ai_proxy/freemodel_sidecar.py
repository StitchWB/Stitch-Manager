"""FreeModel bridge endpoint shim.

The bridge subprocess is owned by the ``stitch-freemodel`` service plugin
(out-of-process since the plugin migration).  The plugin records a running
bridge in ``<plugins-base>/data/plugins/stitch-freemodel/bridge_state.json``;
this module resolves the endpoint from that file so the sidecar-backed
``freemodel`` inference provider keeps working while the plugin runs.

The historical sidecar name is kept verbatim — the plugin writes its state
under the same name and the supervisor/inference wiring keys on it.
"""

from __future__ import annotations

import json
import os
import sys

#: Historical sidecar name — do not rename (plugin state file + inference
#: provider registration both key on it).
SIDECAR_NAME = "freemodel_bridge"

_PLUGIN_ID = "stitch-freemodel"
_STATE_FILENAME = "bridge_state.json"


def resolve_endpoint() -> str | None:
    """Endpoint of the plugin-managed bridge, or None when it is not running.

    Reads the plugin's state file and verifies the recorded pid is alive.
    Pure local I/O — safe to call from the model-fetch hot path.
    """
    from autoreg.plugin.layout import _base_dir

    state_path = (
        _base_dir() / "data" / "plugins" / _PLUGIN_ID / _STATE_FILENAME
    )
    try:
        raw = json.loads(state_path.read_text(encoding="utf-8"))
        if raw.get("sidecar") != SIDECAR_NAME:
            return None
        port = int(raw["port"])
        pid = int(raw["pid"])
    except (OSError, ValueError, KeyError, TypeError):
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
