"""Dual-format routing for radar commands.

``get_radar_offers`` / ``get_radar_stats`` are served by the
``stitch-radar`` plugin.  The dispatcher calls
:func:`try_radar_dual_route` before the command-registry lookup:

- name not in :data:`RADAR_DUAL` → :data:`_FALLTHROUGH` (not ours);
- plugin host absent/unhealthy → structured 400 (no built-in fallback —
  the built-in radar proxy was removed in the plugin migration);
- plugin call error → structured 400/504 (see :mod:`dual_error`).

The radar commands have no common prefix to strip (unlike
``email_inbox_*``), so the built-in name maps to itself (identity
mapping).  The plugin's ``contributions.commands`` list in
``plugins-src/stitch-radar/plugin.json`` mirrors the same names.

Friends (``get_friends``) is NOT part of the dual route — it stays
served exclusively by the built-in community domain.
"""

from __future__ import annotations

import logging
from typing import Any

from stitch_backend.domains.plugin_runtime.dual_error import (
    raise_plugin_call_failed,
    raise_plugin_unavailable,
)

logger = logging.getLogger(__name__)

#: Plugin id that serves radar commands when installed.
RADAR_PLUGIN_ID = "stitch-radar"

#: Module-level sentinel returned by :func:`try_radar_dual_route` to signal
#: the dispatcher to continue to the command-registry lookup (the command
#: is not one of ours).  Using a unique sentinel (not ``None``) lets a
#: plugin legitimately return ``None`` as a command result.
_FALLTHROUGH: Any = object()

#: Command names served by the stitch-radar plugin (identity mapping).
RADAR_DUAL: dict[str, str] = {
    "get_radar_offers": "get_radar_offers",
    "get_radar_stats": "get_radar_stats",
}


def _plugin_healthy(host: Any) -> bool:
    """True if the host is running and not shutting down."""
    return not host._stopping and host.rpc.is_alive


async def try_radar_dual_route(
    name: str, body: dict[str, Any]
) -> Any:
    """Route a radar command to the plugin; clean error when unavailable."""
    plugin_cmd = RADAR_DUAL.get(name)
    if plugin_cmd is None:
        return _FALLTHROUGH

    from autoreg.plugin.rpc import RpcCallError
    from stitch_backend.domains.plugin_runtime import get_host
    from stitch_backend.domains.plugin_runtime.host import (
        PluginCallTimeout,
        PluginNotRunning,
    )

    host = get_host(RADAR_PLUGIN_ID)
    if host is None or not _plugin_healthy(host):
        raise_plugin_unavailable(RADAR_PLUGIN_ID, name)

    # Strip internal dispatcher keys before forwarding to the plugin.
    params = {k: v for k, v in body.items() if not k.startswith("_")}

    try:
        return await host.call(plugin_cmd, params)
    except (PluginNotRunning, PluginCallTimeout, RpcCallError) as exc:
        logger.warning("radar dual: plugin error during '%s'", name, exc_info=True)
        raise_plugin_call_failed(RADAR_PLUGIN_ID, name, exc)


__all__ = [
    "try_radar_dual_route",
    "RADAR_DUAL",
    "RADAR_PLUGIN_ID",
    "_FALLTHROUGH",
]
