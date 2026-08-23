"""Dual-format routing for built-in card commands.

When a healthy ``stitch-cards`` plugin host is registered, the
dispatcher routes ``generate_cards`` / ``check_card_rust`` /
``find_live_card`` commands to the plugin BEFORE falling through to the
built-in command-registry handler.  This avoids flag-day: the built-in
cards domain stays registered, and the plugin takes over only when
installed and healthy.

Pattern: same as ``radar_dual.py`` and ``opencode_dual.py``.  No names
are re-registered in ``command_registry`` — the indirection lives in the
dispatcher, so no overwrite-warning spam.

The card commands have no common prefix to strip (unlike
``email_inbox_*``), so the built-in name maps to itself (identity
mapping).  The plugin's ``contributions.commands`` list in
``plugins-src/stitch-cards/plugin.json`` mirrors the same names.

Entitlements: none extra.  The built-in card commands are not
``admin_only``, so the dual route adds no entitlement gate — the
plugin is reachable by the same callers as the built-in.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

#: Plugin id that serves card commands when installed.
CARDS_PLUGIN_ID = "stitch-cards"

#: Module-level sentinel returned by :func:`try_cards_dual_route` to signal
#: the dispatcher to fall through to the built-in handler.  Using a unique
#: sentinel (not ``None``) lets a plugin legitimately return ``None`` as a
#: command result without being mistaken for fallthrough.
_FALLTHROUGH: Any = object()

#: Built-in command names that have a dual-format plugin counterpart.
#: Maps the built-in name to the plugin command name (identity — no prefix
#: to strip).  Mirrors the manifest commands list in
#: ``plugins-src/stitch-cards/plugin.json`` exactly.
CARDS_DUAL: dict[str, str] = {
    "generate_cards": "generate_cards",
    "check_card_rust": "check_card_rust",
    "find_live_card": "find_live_card",
}


def _plugin_healthy(host: Any) -> bool:
    """True if the host is running and not shutting down."""
    return not host._stopping and host.rpc.is_alive


async def try_cards_dual_route(
    name: str, body: dict[str, Any]
) -> Any:
    """Route a card command to the plugin if healthy.

    Returns the plugin result if routed (including ``None`` — a legitimate
    plugin result that the dispatcher serialises and returns), or
    :data:`_FALLTHROUGH` to signal the dispatcher to fall through to the
    built-in handler unchanged.

    Fall-through conditions (all return :data:`_FALLTHROUGH`):
      - ``name`` is not in :data:`CARDS_DUAL`
      - no ``stitch-cards`` host in the registry
      - host is stopping or child process is dead
      - host died during the call (``PluginNotRunning``)
      - plugin call timed out (``PluginCallTimeout``)
      - plugin returned a JSON-RPC error (``RpcCallError``)
    """
    plugin_cmd = CARDS_DUAL.get(name)
    if plugin_cmd is None:
        return _FALLTHROUGH

    from autoreg.plugin.rpc import RpcCallError
    from stitch_backend.domains.plugin_runtime import get_host
    from stitch_backend.domains.plugin_runtime.host import (
        PluginCallTimeout,
        PluginNotRunning,
    )

    host = get_host(CARDS_PLUGIN_ID)
    if host is None or not _plugin_healthy(host):
        return _FALLTHROUGH

    # Strip internal dispatcher keys before forwarding to the plugin.
    params = {k: v for k, v in body.items() if not k.startswith("_")}

    try:
        return await host.call(plugin_cmd, params)
    except (PluginNotRunning, PluginCallTimeout, RpcCallError):
        logger.warning(
            "cards dual-format: plugin error during '%s', "
            "falling back to built-in",
            name,
            exc_info=True,
        )
        return _FALLTHROUGH


__all__ = [
    "try_cards_dual_route",
    "CARDS_DUAL",
    "CARDS_PLUGIN_ID",
    "_FALLTHROUGH",
]
