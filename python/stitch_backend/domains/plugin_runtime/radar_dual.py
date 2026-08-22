"""Dual-format routing for built-in radar commands.

When a healthy ``stitch-radar`` plugin host is registered, the
dispatcher routes ``get_radar_offers`` / ``get_radar_stats`` commands to
the plugin BEFORE falling through to the built-in command-registry
handler.  This avoids flag-day: the built-in community domain stays
registered, and the plugin takes over only when installed and healthy.

Pattern: same as ``opencode_dual.py`` and ``mail_dual.py``.  No names
are re-registered in ``command_registry`` — the indirection lives in the
dispatcher, so no overwrite-warning spam.

The radar commands have no common prefix to strip (unlike
``email_inbox_*``), so the built-in name maps to itself (identity
mapping).  The plugin's ``contributions.commands`` list in
``plugins-src/stitch-radar/plugin.json`` mirrors the same names.

Friends (``get_friends``) is NOT part of the dual route — it stays
served exclusively by the built-in community domain.

Entitlements: none extra.  The built-in radar commands are not
``admin_only``, so the dual route adds no entitlement gate — the
plugin is reachable by the same callers as the built-in.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

#: Plugin id that serves radar commands when installed.
RADAR_PLUGIN_ID = "stitch-radar"

#: Module-level sentinel returned by :func:`try_radar_dual_route` to signal
#: the dispatcher to fall through to the built-in handler.  Using a unique
#: sentinel (not ``None``) lets a plugin legitimately return ``None`` as a
#: command result without being mistaken for fallthrough.
_FALLTHROUGH: Any = object()

#: Built-in command names that have a dual-format plugin counterpart.
#: Maps the built-in name to the plugin command name (identity — no prefix
#: to strip).  Mirrors the manifest commands list in
#: ``plugins-src/stitch-radar/plugin.json`` exactly.
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
    """Route a radar command to the plugin if healthy.

    Returns the plugin result if routed (including ``None`` — a legitimate
    plugin result that the dispatcher serialises and returns), or
    :data:`_FALLTHROUGH` to signal the dispatcher to fall through to the
    built-in handler unchanged.

    Fall-through conditions (all return :data:`_FALLTHROUGH`):
      - ``name`` is not in :data:`RADAR_DUAL`
      - no ``stitch-radar`` host in the registry
      - host is stopping or child process is dead
      - host died during the call (``PluginNotRunning``)
      - plugin call timed out (``PluginCallTimeout``)
      - plugin returned a JSON-RPC error (``RpcCallError``)
    """
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
        return _FALLTHROUGH

    # Strip internal dispatcher keys before forwarding to the plugin.
    params = {k: v for k, v in body.items() if not k.startswith("_")}

    try:
        return await host.call(plugin_cmd, params)
    except (PluginNotRunning, PluginCallTimeout, RpcCallError):
        logger.warning(
            "radar dual-format: plugin error during '%s', "
            "falling back to built-in",
            name,
            exc_info=True,
        )
        return _FALLTHROUGH


__all__ = [
    "try_radar_dual_route",
    "RADAR_DUAL",
    "RADAR_PLUGIN_ID",
    "_FALLTHROUGH",
]
