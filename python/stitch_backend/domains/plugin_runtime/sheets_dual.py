"""Dual-format routing for google_sheets_* commands.

``google_sheets_*`` CRUD commands are served by the ``stitch-sheets``
plugin (stripping the ``google_sheets_`` prefix).  The dispatcher calls
:func:`try_sheets_dual_route` before the command-registry lookup:

- name not in :data:`SHEETS_DUAL` → :data:`_FALLTHROUGH` (not ours);
- plugin host absent/unhealthy → structured 400 (no built-in fallback —
  the built-in google_sheets CRUD was removed in the plugin migration);
- plugin call error → structured 400/504 (see :mod:`dual_error`).

The ``google_oauth_*`` commands are core-only and never reach this router.
"""

from __future__ import annotations

import logging
from typing import Any

from stitch_backend.domains.plugin_runtime.dual_error import (
    raise_plugin_call_failed,
    raise_plugin_unavailable,
)

logger = logging.getLogger(__name__)

#: Plugin id that serves sheets commands when installed.
SHEETS_PLUGIN_ID = "stitch-sheets"

#: Module-level sentinel returned by :func:`try_sheets_dual_route` to signal
#: the dispatcher to continue to the command-registry lookup (the command
#: is not one of ours).  Using a unique sentinel (not ``None``) lets a
#: plugin legitimately return ``None`` as a command result.
_FALLTHROUGH: Any = object()

#: Command names served by the stitch-sheets plugin.
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
    """Route a ``google_sheets_*`` command to the plugin; clean error when
    unavailable."""
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
        raise_plugin_unavailable(SHEETS_PLUGIN_ID, name)

    # Strip internal dispatcher keys before forwarding to the plugin.
    params = {k: v for k, v in body.items() if not k.startswith("_")}

    try:
        return await host.call(plugin_cmd, params)
    except (PluginNotRunning, PluginCallTimeout, RpcCallError) as exc:
        logger.warning("sheets dual: plugin error during '%s'", name, exc_info=True)
        raise_plugin_call_failed(SHEETS_PLUGIN_ID, name, exc)


__all__ = [
    "try_sheets_dual_route",
    "SHEETS_DUAL",
    "SHEETS_PLUGIN_ID",
    "_FALLTHROUGH",
]
