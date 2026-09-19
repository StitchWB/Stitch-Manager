"""Dual-format routing for email_* / email_inbox_* commands.

``email_generate_from_settings*`` / ``email_test_strategies`` /
``email_inbox_*`` commands are served by the ``stitch-mail`` plugin
(stripping the ``email_`` / ``email_inbox_`` prefix).  The dispatcher calls
:func:`try_mail_dual_route` before the command-registry lookup:

- name not in :data:`MAIL_DUAL` → :data:`_FALLTHROUGH` (not ours);
- plugin host absent/unhealthy → structured 400 (no built-in fallback —
  the built-in email_inbox domain was removed in the plugin migration);
- plugin call error → structured 400/504 (see :mod:`dual_error`).

Owner identity is forwarded under unprefixed names
(``caller_user_id`` / ``caller_role``) so the plugin can scope profile
rows by owner — parallel to the totp_dual and notebooklm cookies
passthrough.
"""

from __future__ import annotations

import logging
from typing import Any

from stitch_backend.domains.plugin_runtime.dual_error import (
    raise_plugin_call_failed,
    raise_plugin_unavailable,
)

logger = logging.getLogger(__name__)

#: Plugin id that serves mail commands when installed.
MAIL_PLUGIN_ID = "stitch-mail"

#: Module-level sentinel returned by :func:`try_mail_dual_route` to signal
#: the dispatcher to continue to the command-registry lookup (the command
#: is not one of ours).  Using a unique sentinel (not ``None``) lets a
#: plugin legitimately return ``None`` as a command result — the dispatcher
#: checks ``is not _FALLTHROUGH`` so a plugin-served ``None`` is serialised
#: and returned to the caller.
_FALLTHROUGH: Any = object()

#: Command names served by the stitch-mail plugin.
#: Maps the built-in name (with ``email_`` / ``email_inbox_`` prefix) to
#: the plugin command name (without the prefix).  Mirrors the manifest
#: commands list in ``plugins-src/stitch-mail/plugin.json`` exactly.
MAIL_DUAL: dict[str, str] = {
    # email_* (generate / test strategies)
    "email_generate_from_settings": "generate_from_settings",
    "email_generate_from_settings_persistent": "generate_from_settings_persistent",
    "email_test_strategies": "test_strategies",
    # email_inbox_* (connection + mailbox)
    "email_inbox_connect": "connect",
    "email_inbox_disconnect": "disconnect",
    "email_inbox_list": "list",
    "email_inbox_list_folders": "list_folders",
    "email_inbox_get_by_id": "get_by_id",
    "email_inbox_wait_for_email": "wait_for_email",
    "email_inbox_mark_as_read": "mark_as_read",
    "email_inbox_delete": "delete",
    "email_inbox_create_mailtm_account": "create_mailtm_account",
    "email_inbox_get_capabilities": "get_capabilities",
    "email_inbox_get_provider_catalog": "get_provider_catalog",
    # email_inbox_* (profiles + sync state)
    "email_inbox_list_profiles": "list_profiles",
    "email_inbox_get_profile": "get_profile",
    "email_inbox_upsert_profile": "upsert_profile",
    "email_inbox_delete_profile": "delete_profile",
    "email_inbox_connect_profile": "connect_profile",
    "email_inbox_get_sync_state": "get_sync_state",
    "email_inbox_upsert_sync_state": "upsert_sync_state",
}


def _plugin_healthy(host: Any) -> bool:
    """True if the host is running and not shutting down."""
    return not host._stopping and host.rpc.is_alive


async def try_mail_dual_route(
    name: str, body: dict[str, Any]
) -> Any:
    """Route an ``email_*`` / ``email_inbox_*`` command to the plugin;
    clean error when unavailable.

    Owner identity is forwarded under unprefixed names
    (``caller_user_id`` / ``caller_role``) so the plugin can scope
    profile rows by owner.  Internal ``_``-prefixed dispatcher keys
    are stripped before forwarding.
    """
    plugin_cmd = MAIL_DUAL.get(name)
    if plugin_cmd is None:
        return _FALLTHROUGH

    from autoreg.plugin.rpc import RpcCallError
    from stitch_backend.domains.plugin_runtime import get_host
    from stitch_backend.domains.plugin_runtime.host import (
        PluginCallTimeout,
        PluginNotRunning,
    )

    host = get_host(MAIL_PLUGIN_ID)
    if host is None or not _plugin_healthy(host):
        raise_plugin_unavailable(MAIL_PLUGIN_ID, name)

    # Strip internal dispatcher keys, then forward caller identity.
    params = {k: v for k, v in body.items() if not k.startswith("_")}
    params["caller_user_id"] = body.get("_caller_user_id")
    params["caller_role"] = body.get("_caller_role")

    try:
        return await host.call(plugin_cmd, params)
    except (PluginNotRunning, PluginCallTimeout, RpcCallError) as exc:
        logger.warning("mail dual: plugin error during '%s'", name, exc_info=True)
        raise_plugin_call_failed(MAIL_PLUGIN_ID, name, exc)


__all__ = [
    "try_mail_dual_route",
    "MAIL_DUAL",
    "MAIL_PLUGIN_ID",
    "_FALLTHROUGH",
]
