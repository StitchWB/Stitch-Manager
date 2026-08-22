"""Dual-format routing for built-in google_sheets_* commands (plan todo 21).

When a healthy ``stitch-sheets`` plugin host is registered, the
dispatcher routes ``google_sheets_*`` commands to the plugin (stripping
the ``google_sheets_`` prefix) BEFORE falling through to the built-in
command-registry handler.  This avoids flag-day: the built-in domain
stays registered, and the plugin takes over only when installed and
healthy.

Pattern: same as ``dual_format.py`` for notebooklm (v1 solution 9).
No names are re-registered in ``command_registry`` — the indirection
lives in the dispatcher, so no overwrite-warning spam.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

#: Plugin id that serves sheets commands when installed.
SHEETS_PLUGIN_ID = "stitch-sheets"

#: Module-level sentinel returned by :func:`try_sheets_dual_route` to signal
#: the dispatcher to fall through to the built-in handler.  Using a unique
#: sentinel (not ``None``) lets a plugin legitimately return ``None`` as a
#: command result without being mistaken for fallthrough.
_FALLTHROUGH: Any = object()

#: Built-in command names that have a dual-format plugin counterpart.
#: Maps the built-in name (with ``google_sheets_`` prefix) to the plugin
#: command name (without the prefix).
SHEETS_DUAL: dict[str, str] = {
    "test_google_sheets_connection": "test_connection",
    "fetch_google_sheets_dataset": "fetch_dataset",
    "init_google_sheets_schema": "init_schema",
    "upsert_google_sheets_link": "upsert_link",
    "delete_google_sheets_link": "delete_link",
    "upsert_google_sheets_account_link": "upsert_account_link",
    "delete_google_sheets_account_link": "delete_account_link",
    "upsert_google_sheets_profile_link": "upsert_profile_link",
    "delete_google_sheets_profile_link": "delete_profile_link",
    "upsert_google_sheets_auth_method": "upsert_auth_method",
    "delete_google_sheets_auth_method": "delete_auth_method",
    "upsert_google_sheets_account_auth_link": "upsert_account_auth_link",
    "delete_google_sheets_account_auth_link": "delete_account_auth_link",
}


def _plugin_healthy(host: Any) -> bool:
    """True if the host is running and not shutting down."""
    return not host._stopping and host.rpc.is_alive


async def try_sheets_dual_route(
    name: str, body: dict[str, Any]
) -> Any:
    """Route a ``google_sheets_*`` command to the plugin if healthy.

    Returns the plugin result if routed (including ``None``), or
    :data:`_FALLTHROUGH` to signal the dispatcher to fall through to the
    built-in handler unchanged.

    Fall-through conditions (all return :data:`_FALLTHROUGH`):
      - ``name`` is not in :data:`SHEETS_DUAL`
      - no ``stitch-sheets`` host in the registry
      - host is stopping or child process is dead
      - host died during the call (``PluginNotRunning``)
      - plugin call timed out (``PluginCallTimeout``)
      - plugin returned a JSON-RPC error (``RpcCallError``)
    """
    plugin_cmd = SHEETS_DUAL.get(name)
    if plugin_cmd is None:
        return _FALLTHROUGH

    from autoreg.plugin.rpc import RpcCallError
    from stitch_backend.domains.plugin_runtime import get_host
    from stitch_backend.domains.plugin_runtime.host import (
        PluginCallTimeout,
        PluginNotRunning,
    )

    host = get_host(SHEETS_PLUGIN_ID)
    if host is None or not _plugin_healthy(host):
        return _FALLTHROUGH

    # Strip internal dispatcher keys before forwarding to the plugin.
    params = {k: v for k, v in body.items() if not k.startswith("_")}

    try:
        return await host.call(plugin_cmd, params)
    except (PluginNotRunning, PluginCallTimeout, RpcCallError):
        logger.warning(
            "sheets dual-format: plugin error during '%s', "
            "falling back to built-in",
            name,
            exc_info=True,
        )
        return _FALLTHROUGH


__all__ = [
    "try_sheets_dual_route",
    "SHEETS_DUAL",
    "SHEETS_PLUGIN_ID",
    "_FALLTHROUGH",
]
