"""FreeModel bridge endpoint shim.

The bridge subprocess is owned by the ``stitch-freemodel`` service plugin,
which records a running bridge in
``<plugins-base>/data/plugins/stitch-freemodel/bridge_state.json``; this module
resolves the endpoint from that file (verified via :mod:`bridge_state`) so the
sidecar-backed ``freemodel`` inference provider keeps working while the plugin
runs.
"""

from __future__ import annotations

import os
import shutil

from .bridge_state import resolve_plugin_bridge

#: Historical sidecar name - do not rename (plugin state + provider keys on it).
SIDECAR_NAME = "freemodel_bridge"

_PLUGIN_ID = "stitch-freemodel"


def resolve_endpoint() -> str | None:
    """Endpoint of the plugin-managed FreeModel bridge, or None."""
    return resolve_plugin_bridge(_PLUGIN_ID, SIDECAR_NAME)


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
