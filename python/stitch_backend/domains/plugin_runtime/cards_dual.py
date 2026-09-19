"""Dual-format routing for card commands.

``generate_cards`` / ``check_card_rust`` / ``find_live_card`` are served by
the ``stitch-cards`` plugin.  The dispatcher calls
:func:`try_cards_dual_route` before the command-registry lookup:

- name not in :data:`CARDS_DUAL` → :data:`_FALLTHROUGH` (not ours);
- plugin host absent/unhealthy → structured 400 (no built-in fallback —
  the built-in cards domain was removed in the plugin migration);
- plugin call error → structured 400/504 (see :mod:`dual_error`).

The card commands have no common prefix to strip (unlike
``email_inbox_*``), so the built-in name maps to itself (identity
mapping).  The plugin's ``contributions.commands`` list in
``plugins-src/stitch-cards/plugin.json`` mirrors the same names.

The network commands (``check_card_rust`` / ``find_live_card``) receive the
core outbound proxy (kiro-patch config) as a ``proxy`` param — the plugin
has no access to core settings, so the router injects it.
"""

from __future__ import annotations

import logging
from typing import Any

from stitch_backend.domains.plugin_runtime.dual_error import (
    raise_plugin_call_failed,
    raise_plugin_unavailable,
)

logger = logging.getLogger(__name__)

#: Plugin id that serves card commands when installed.
CARDS_PLUGIN_ID = "stitch-cards"

#: Module-level sentinel returned by :func:`try_cards_dual_route` to signal
#: the dispatcher to continue to the command-registry lookup (the command
#: is not one of ours).  Using a unique sentinel (not ``None``) lets a
#: plugin legitimately return ``None`` as a command result.
_FALLTHROUGH: Any = object()

#: Command names served by the stitch-cards plugin (identity mapping).
CARDS_DUAL: dict[str, str] = {
    "generate_cards": "generate_cards",
    "check_card_rust": "check_card_rust",
    "find_live_card": "find_live_card",
}

#: Commands that perform outbound HTTP and therefore receive the core
#: outbound proxy as a ``proxy`` param.
_PROXY_COMMANDS = frozenset({"check_card_rust", "find_live_card"})


def _plugin_healthy(host: Any) -> bool:
    """True if the host is running and not shutting down."""
    return not host._stopping and host.rpc.is_alive


async def try_cards_dual_route(
    name: str, body: dict[str, Any]
) -> Any:
    """Route a card command to the plugin; clean error when unavailable."""
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
        raise_plugin_unavailable(CARDS_PLUGIN_ID, name)

    # Strip internal dispatcher keys before forwarding to the plugin.
    params = {k: v for k, v in body.items() if not k.startswith("_")}
    if name in _PROXY_COMMANDS:
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy

        params["proxy"] = _get_outbound_proxy()

    try:
        return await host.call(plugin_cmd, params)
    except (PluginNotRunning, PluginCallTimeout, RpcCallError) as exc:
        logger.warning("cards dual: plugin error during '%s'", name, exc_info=True)
        raise_plugin_call_failed(CARDS_PLUGIN_ID, name, exc)


__all__ = [
    "try_cards_dual_route",
    "CARDS_DUAL",
    "CARDS_PLUGIN_ID",
    "_FALLTHROUGH",
]
