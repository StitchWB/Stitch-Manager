"""Dual-format routing for built-in opencode_config commands.

When a healthy ``stitch-opencode`` plugin host is registered, the
dispatcher routes ``get_opencode_config`` / ``set_opencode_config`` /
``get_oh_my_openagent_config`` / ``set_oh_my_openagent_config`` /
``test_opencode_api`` / ``bulk_test_opencode_api`` commands to the plugin
BEFORE falling through to the built-in command-registry handler.  This
avoids flag-day: the built-in domain stays registered, and the plugin
takes over only when installed and healthy.

Pattern: same as ``mail_dual.py`` and ``sheets_dual.py``.  No names are
re-registered in ``command_registry`` — the indirection lives in the
dispatcher, so no overwrite-warning spam.

The opencode_config commands have no common prefix to strip (unlike
``email_inbox_*``), so the built-in name maps to itself (identity
mapping).  The plugin's ``contributions.commands`` list in
``plugins-src/stitch-opencode/plugin.json`` mirrors the same names.

Entitlements: none extra.  The built-in opencode_config commands are
not ``admin_only``, so the dual route adds no entitlement gate — the
plugin is reachable by the same callers as the built-in.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

#: Plugin id that serves opencode_config commands when installed.
OPENCODE_PLUGIN_ID = "stitch-opencode"

#: Module-level sentinel returned by :func:`try_opencode_dual_route` to signal
#: the dispatcher to fall through to the built-in handler.  Using a unique
#: sentinel (not ``None``) lets a plugin legitimately return ``None`` as a
#: command result without being mistaken for fallthrough.
_FALLTHROUGH: Any = object()

#: Built-in command names that have a dual-format plugin counterpart.
#: Maps the built-in name to the plugin command name (identity — no prefix
#: to strip).  Mirrors the manifest commands list in
#: ``plugins-src/stitch-opencode/plugin.json`` exactly.
OPENCODE_DUAL: dict[str, str] = {
    "get_opencode_config": "get_opencode_config",
    "set_opencode_config": "set_opencode_config",
    "get_oh_my_openagent_config": "get_oh_my_openagent_config",
    "set_oh_my_openagent_config": "set_oh_my_openagent_config",
    "test_opencode_api": "test_opencode_api",
    "bulk_test_opencode_api": "bulk_test_opencode_api",
}


def _plugin_healthy(host: Any) -> bool:
    """True if the host is running and not shutting down."""
    return not host._stopping and host.rpc.is_alive


async def try_opencode_dual_route(
    name: str, body: dict[str, Any]
) -> Any:
    """Route an opencode_config command to the plugin if healthy.

    Returns the plugin result if routed (including ``None`` — a legitimate
    plugin result that the dispatcher serialises and returns), or
    :data:`_FALLTHROUGH` to signal the dispatcher to fall through to the
    built-in handler unchanged.

    Fall-through conditions (all return :data:`_FALLTHROUGH`):
      - ``name`` is not in :data:`OPENCODE_DUAL`
      - no ``stitch-opencode`` host in the registry
      - host is stopping or child process is dead
      - host died during the call (``PluginNotRunning``)
      - plugin call timed out (``PluginCallTimeout``)
      - plugin returned a JSON-RPC error (``RpcCallError``)
    """
    plugin_cmd = OPENCODE_DUAL.get(name)
    if plugin_cmd is None:
        return _FALLTHROUGH

    from autoreg.plugin.rpc import RpcCallError
    from stitch_backend.domains.plugin_runtime import get_host
    from stitch_backend.domains.plugin_runtime.host import (
        PluginCallTimeout,
        PluginNotRunning,
    )

    host = get_host(OPENCODE_PLUGIN_ID)
    if host is None or not _plugin_healthy(host):
        return _FALLTHROUGH

    # Strip internal dispatcher keys before forwarding to the plugin.
    params = {k: v for k, v in body.items() if not k.startswith("_")}

    try:
        return await host.call(plugin_cmd, params)
    except (PluginNotRunning, PluginCallTimeout, RpcCallError):
        logger.warning(
            "opencode dual-format: plugin error during '%s', "
            "falling back to built-in",
            name,
            exc_info=True,
        )
        return _FALLTHROUGH


__all__ = [
    "try_opencode_dual_route",
    "OPENCODE_DUAL",
    "OPENCODE_PLUGIN_ID",
    "_FALLTHROUGH",
]
