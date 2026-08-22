"""Dual-format routing for built-in email_* / email_inbox_* commands (plan todo 16).

When a healthy ``stitch-mail`` plugin host is registered, the dispatcher
routes ``email_*`` / ``email_inbox_*`` commands to the plugin (stripping
the ``email_`` / ``email_inbox_`` prefix) BEFORE falling through to the
built-in command-registry handler.  This avoids flag-day: the built-in
domain stays registered, and the plugin takes over only when installed
and healthy.

Pattern: same as ``dual_format.py`` for notebooklm and ``sheets_dual.py``
for google_sheets (v1 solution 9).  No names are re-registered in
``command_registry`` — the indirection lives in the dispatcher, so no
overwrite-warning spam.

Owner identity is forwarded under ``owner_id`` (from
``_caller_user_id`` when present) so the plugin can scope profile rows
by owner — parallel to the notebooklm cookies passthrough.

Entitlements: none extra.  The built-in email commands are not
``admin_only``, so the dual route adds no entitlement gate — the plugin
is reachable by the same callers as the built-in.  Readonly metadata
is not enforced by the dual route (same as sheets_dual); the built-in
meta stays untouched.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

#: Plugin id that serves mail commands when installed.
MAIL_PLUGIN_ID = "stitch-mail"

#: Built-in command names that have a dual-format plugin counterpart.
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
) -> Any | None:
    """Route an ``email_*`` / ``email_inbox_*`` command to the plugin if healthy.

    Returns the plugin result if routed, or ``None`` to signal the
    dispatcher to fall through to the built-in handler unchanged.

    Fall-through conditions (all return ``None``):
      - ``name`` is not in :data:`MAIL_DUAL`
      - no ``stitch-mail`` host in the registry
      - host is stopping or child process is dead
      - host died during the call (``PluginNotRunning``)

    Owner identity is forwarded under ``owner_id`` (from
    ``_caller_user_id`` when present) so the plugin can scope rows by
    owner.  Internal ``_``-prefixed dispatcher keys are stripped before
    forwarding.  Other ``Rpc`` errors propagate (they surface as 400 in
    the dispatcher's generic exception handler).
    """
    plugin_cmd = MAIL_DUAL.get(name)
    if plugin_cmd is None:
        return None

    from stitch_backend.domains.plugin_runtime import get_host
    from stitch_backend.domains.plugin_runtime.host import PluginNotRunning

    host = get_host(MAIL_PLUGIN_ID)
    if host is None or not _plugin_healthy(host):
        return None

    # Strip internal dispatcher keys before forwarding to the plugin.
    params = {k: v for k, v in body.items() if not k.startswith("_")}

    # Forward caller identity as owner_id when present so the plugin
    # can scope profile rows by owner.
    caller_user_id = body.get("_caller_user_id")
    if caller_user_id is not None:
        params["owner_id"] = caller_user_id

    try:
        return await host.call(plugin_cmd, params)
    except PluginNotRunning:
        logger.warning(
            "mail dual-format: plugin died during '%s', "
            "falling back to built-in",
            name,
        )
        return None


__all__ = ["try_mail_dual_route", "MAIL_DUAL", "MAIL_PLUGIN_ID"]
