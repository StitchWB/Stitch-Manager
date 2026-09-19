"""Dual-format routing for opencode_config commands.

``get_opencode_config`` / ``set_opencode_config`` /
``get_oh_my_openagent_config`` / ``set_oh_my_openagent_config`` /
``test_opencode_api`` / ``bulk_test_opencode_api`` are served by the
``stitch-opencode`` plugin.  The dispatcher calls
:func:`try_opencode_dual_route` before the command-registry lookup:

- name not in :data:`OPENCODE_DUAL` → :data:`_FALLTHROUGH` (not ours);
- plugin host absent/unhealthy → structured 400 (no built-in fallback —
  the built-in opencode_config domain was removed in the plugin
  migration);
- plugin call error → structured 400/504 (see :mod:`dual_error`).

The opencode_config commands have no common prefix to strip (unlike
``email_inbox_*``), so the built-in name maps to itself (identity
mapping).  The plugin's ``contributions.commands`` list in
``plugins-src/stitch-opencode/plugin.json`` mirrors the same names.
"""

from __future__ import annotations

import logging
from typing import Any

from stitch_backend.domains.plugin_runtime.dual_error import (
    raise_plugin_call_failed,
    raise_plugin_unavailable,
)

logger = logging.getLogger(__name__)

#: Plugin id that serves opencode_config commands when installed.
OPENCODE_PLUGIN_ID = "stitch-opencode"

#: Module-level sentinel returned by :func:`try_opencode_dual_route` to
#: signal the dispatcher to continue to the command-registry lookup (the
#: command is not one of ours).  Using a unique sentinel (not ``None``)
#: lets a plugin legitimately return ``None`` as a command result.
_FALLTHROUGH: Any = object()

#: Command names served by the stitch-opencode plugin (identity mapping).
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
    """Route an opencode_config command to the plugin; clean error when
    unavailable."""
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
        raise_plugin_unavailable(OPENCODE_PLUGIN_ID, name)

    # Strip internal dispatcher keys before forwarding to the plugin.
    params = {k: v for k, v in body.items() if not k.startswith("_")}

    try:
        return await host.call(plugin_cmd, params)
    except (PluginNotRunning, PluginCallTimeout, RpcCallError) as exc:
        logger.warning("opencode dual: plugin error during '%s'", name, exc_info=True)
        raise_plugin_call_failed(OPENCODE_PLUGIN_ID, name, exc)


__all__ = [
    "try_opencode_dual_route",
    "OPENCODE_DUAL",
    "OPENCODE_PLUGIN_ID",
    "_FALLTHROUGH",
]
