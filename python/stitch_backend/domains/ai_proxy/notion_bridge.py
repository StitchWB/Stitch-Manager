"""Notion bridge endpoint shim.

The bridge runs inside the ``stitch-bridges`` service plugin, which publishes
its loopback endpoint (and a liveness PID) to a HMAC-signed
``bridge_state.json`` in the plugin data dir.  This shim resolves that endpoint
for the sidecar-backed ``notion`` inference provider — same contract as the
FreeModel bridge (see :mod:`bridge_state`).
"""

from __future__ import annotations

from .bridge_state import resolve_plugin_bridge

#: Sidecar name in the plugin state file; the provider + fetch key on it.
SIDECAR_NAME = "notion_bridge"

_PLUGIN_ID = "stitch-bridges"


def resolve_endpoint() -> str | None:
    """Loopback endpoint of the plugin-managed Notion bridge, or None."""
    return resolve_plugin_bridge(_PLUGIN_ID, SIDECAR_NAME)
