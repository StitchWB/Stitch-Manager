"""Dual-format routing for built-in totp commands (plan todo 20).

When a healthy ``stitch-totp`` plugin host is registered, the built-in
totp command handlers route to the plugin (command names without the
totp prefix) BEFORE the built-in handler runs.  This avoids flag-day:
the built-in domain stays registered, and the plugin takes over only
when installed and healthy.  The indirection lives in wrapped registry
handlers (installed by :func:`install_totp_dual_routing`) that route
plugin-first with a fallthrough sentinel — no dispatcher edit and no
command re-registration (no overwrite-warning spam).

Single live secret store: while the plugin is healthy, built-in writes
are bypassed entirely (the routed handler returns the plugin result and
the built-in handler never runs), so the core ``totp_keys`` table stays
frozen.  ``migrate_totp_to_plugin`` (admin-only) pushes the frozen core
rows into the plugin store once; idempotent (plugin upserts by key id).
The core table is only removed in the built-in removal wave (todo 24).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException

from stitch_backend.core.command_registry import (
    CommandNotFoundError,
    get_command_handler,
    register_command,
)

logger = logging.getLogger(__name__)

#: Plugin id that serves totp commands when installed.
TOTP_PLUGIN_ID = "stitch-totp"

#: Module-level sentinel returned by :func:`try_totp_route` to signal the
#: wrapped built-in handler should run unchanged.  Using a unique sentinel
#: (not ``None``) lets a plugin legitimately return ``None`` as a command
#: result without being mistaken for fallthrough.
_FALLTHROUGH: Any = object()

#: Built-in command names that have a dual-format plugin counterpart.
#: Maps the built-in name to the plugin command name (no totp prefix).
TOTP_DUAL: dict[str, str] = {
    "list_totp_keys": "list_keys",
    "add_totp_key": "add_key",
    "update_totp_key": "update_key",
    "remove_totp_key": "remove_key",
    "link_totp_key": "link_key",
    "claim_totp_key": "claim_key",
    "totp_share_group": "share_group",
    "totp_unshare_group": "unshare_group",
}

#: Names already wrapped by :func:`install_totp_dual_routing` (idempotency).
_wrapped: set[str] = set()


def _plugin_healthy(host: Any) -> bool:
    """True if the host is running and not shutting down."""
    return not host._stopping and host.rpc.is_alive


async def try_totp_route(name: str, body: dict[str, Any]) -> Any:
    """Route a totp command to the plugin if healthy.

    Returns the plugin result if routed (including ``None``), or
    :data:`_FALLTHROUGH` to signal the built-in handler should run
    unchanged.

    Fall-through conditions (all return :data:`_FALLTHROUGH`):
      - ``name`` is not in :data:`TOTP_DUAL`
      - no ``stitch-totp`` host in the registry
      - host is stopping or child process is dead
      - host died during the call (``PluginNotRunning``)
      - plugin call timed out (``PluginCallTimeout``)
      - plugin returned a JSON-RPC error (``RpcCallError``)

    Caller identity is forwarded under unprefixed names
    (``caller_user_id`` / ``caller_role``) so the plugin can scope rows
    by owner — parallel to the notebooklm cookies passthrough.
    """
    plugin_cmd = TOTP_DUAL.get(name)
    if plugin_cmd is None:
        return _FALLTHROUGH

    from autoreg.plugin.rpc import RpcCallError
    from stitch_backend.domains.plugin_runtime import get_host
    from stitch_backend.domains.plugin_runtime.host import (
        PluginCallTimeout,
        PluginNotRunning,
    )

    host = get_host(TOTP_PLUGIN_ID)
    if host is None or not _plugin_healthy(host):
        return _FALLTHROUGH

    # Strip internal dispatcher keys, then forward caller identity.
    params = {k: v for k, v in body.items() if not k.startswith("_")}
    params["caller_user_id"] = body.get("_caller_user_id")
    params["caller_role"] = body.get("_caller_role")

    try:
        return await host.call(plugin_cmd, params)
    except (PluginNotRunning, PluginCallTimeout, RpcCallError):
        # Host died, timed out, or returned a JSON-RPC error — fall back
        # to the built-in handler instead of surfacing as HTTP 400.
        logger.warning(
            "totp dual-format: plugin error during '%s', "
            "falling back to built-in",
            name,
            exc_info=True,
        )
        return _FALLTHROUGH


def install_totp_dual_routing() -> None:
    """Wrap the registered totp handlers with plugin-first routing.

    Idempotent.  Handlers are swapped in place in the registry (no
    ``register_command`` call — no overwrite-warning spam; command
    metadata is untouched).  Missing commands (open-core build without
    the totp domain) are skipped.  Must be called explicitly from
    :func:`stitch_backend.main.lifespan` AFTER the built-in totp
    commands are registered (the lifespan imports
    ``domains.totp.commands`` then this module then calls this function).
    """
    from stitch_backend.core.command_registry import _COMMAND_REGISTRY

    for name in TOTP_DUAL:
        if name in _wrapped:
            continue
        try:
            original = get_command_handler(name)
        except CommandNotFoundError:
            continue

        async def _routed(params: dict, *, _orig=original, _name=name):
            result = await try_totp_route(_name, params)
            if result is not _FALLTHROUGH:
                return result
            return await _orig(params)

        _COMMAND_REGISTRY[name] = _routed
        _wrapped.add(name)


# ── Migration: core totp_keys → plugin store ─────────────────────────────


async def _read_core_totp_rows() -> list[dict[str, Any]]:
    """Read every core ``totp_keys`` row as a JSON-safe dict.

    Secrets are decrypted transparently by the ``EncryptedText`` column
    type, so the plugin receives plaintext and re-encrypts with its own
    (Fernet-compatible) key.
    """
    from sqlalchemy import select

    from stitch_backend.database import run_in_read_session

    async def _op(session):
        from stitch_backend.domains.totp.models import TotpKey

        result = await session.execute(
            select(TotpKey).order_by(TotpKey.created_at)
        )
        return [
            {
                "id": key.id,
                "ownerId": key.owner_id,
                "label": key.label,
                "secret": key.secret,
                "issuer": key.issuer,
                "accountId": key.account_id,
                "digits": key.digits,
                "period": key.period,
                "algorithm": key.algorithm,
                "enabled": key.enabled,
                "createdAt": (
                    key.created_at.isoformat() if key.created_at else None
                ),
            }
            for key in result.scalars().all()
        ]

    return await run_in_read_session(_op)


@register_command("migrate_totp_to_plugin", admin_only=True)
async def cmd_migrate_totp_to_plugin(params: dict[str, Any]) -> dict[str, Any]:
    """Push core ``totp_keys`` rows into the stitch-totp plugin store.

    Admin-only, idempotent (the plugin upserts by key id).  The core
    table is read but never written here — it stays frozen until the
    built-in removal wave.
    """
    from stitch_backend.domains.plugin_runtime import get_host

    host = get_host(TOTP_PLUGIN_ID)
    if host is None or not _plugin_healthy(host):
        raise HTTPException(
            status_code=400, detail="plugin not installed: stitch-totp"
        )

    rows = await _read_core_totp_rows()
    result = await host.call("import_secrets", {"rows": rows})
    return {"rows": len(rows), "plugin": result}
