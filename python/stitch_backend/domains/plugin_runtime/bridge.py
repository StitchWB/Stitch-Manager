"""Thin bridge for namespaced plugin commands + ``list_service_plugins``.

The dispatcher routes ``plugin.{id}.{cmd}`` names here BEFORE looking them
up in the command registry (no dynamic re-registration — avoids the
overwrite-warning spam in :func:`command_registry.register_command`).
The bridge resolves the host from the plugin_runtime registry, checks
entitlements, and calls the host's RPC client.

Error mapping:
  - Unknown plugin (no host)        → 404
  - Caller not entitled             → 403
  - RPC timeout (``PluginCallTimeout``) → 504
  - RPC call error / not running    → 400
"""

from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import HTTPException, status

# Imported for its side effect: registers ``get_service_plugin_health``
# (todo 25) when the dispatcher imports this bridge at startup.
import stitch_backend.domains.plugin_runtime.monitoring  # noqa: F401,E402
from stitch_backend.core.command_registry import register_command
from stitch_backend.domains.plugin_runtime import (
    all_hosts,
    get_host,
    get_manifest,
)
from stitch_backend.domains.plugin_runtime.host import SUPPORTED_CAPABILITIES

logger = logging.getLogger(__name__)

_PLUGIN_PREFIX = "plugin."
# Plugin id charset: [A-Za-z0-9_-], no dots (matches manifest._PLUGIN_ID_RE).
_PLUGIN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


def parse_plugin_command(name: str) -> tuple[str, str] | None:
    """Parse ``plugin.{id}.{cmd}`` → ``(id, cmd)`` or ``None``.

    The id is the segment between the first and second dots and must
    match the manifest id charset ``[A-Za-z0-9_-]`` (no dots).  The
    command is everything after the second dot and may itself contain
    dots (e.g. ``plugin.echo.sub.ping`` → id=``echo``, cmd=``sub.ping``).
    """
    if not name.startswith(_PLUGIN_PREFIX):
        return None
    rest = name[len(_PLUGIN_PREFIX):]
    dot = rest.find(".")
    if dot < 0:
        return None
    plugin_id = rest[:dot]
    cmd = rest[dot + 1:]
    if not plugin_id or not _PLUGIN_ID_RE.match(plugin_id) or not cmd:
        return None
    return plugin_id, cmd


async def call_plugin_command(name: str, body: dict[str, Any]) -> Any:
    """Resolve and execute a namespaced plugin command.

    Raises :class:`fastapi.HTTPException` on:
      - 404: unknown plugin (no host in registry) or malformed name
      - 403: caller not entitled to the plugin
      - 504: RPC timeout
      - 400: RPC call error or plugin not running

    Sandbox shadowing: when the caller is an authenticated user who owns a
    sandbox host for ``plugin_id``, the call routes to the sandbox host
    INSTEAD of the global host.  The owner bypasses the entitlement gate
    (their dev artifact).  Non-owners never see someone else's sandbox —
    the sandbox lookup is keyed by ``caller_user_id``.
    """
    from autoreg.plugin.rpc import RpcCallError

    from stitch_backend.domains.plugin_runtime.host import (
        PluginCallTimeout,
        PluginNotRunning,
    )

    parsed = parse_plugin_command(name)
    if parsed is None:
        raise HTTPException(
            status_code=404, detail=f"Unknown plugin command: '{name}'"
        )
    plugin_id, cmd = parsed

    caller_user_id = body.get("_caller_user_id")
    caller_role = body.get("_caller_role")

    # ── Sandbox shadowing (owner-only) ───────────────────────────────────
    # When the caller owns a sandbox host for this plugin id, route there
    # INSTEAD of the global host.  The owner bypasses the entitlement gate
    # (it's their dev artifact).  Non-owners fall through to the global
    # path and never see the sandbox host.
    host = None
    if caller_user_id is not None:
        from stitch_backend.domains.plugin_runtime.sandbox import (
            ensure_sandbox_host,
        )
        host = await ensure_sandbox_host(caller_user_id, plugin_id)

    if host is None:
        # ── Global path (unchanged) ───────────────────────────────────────
        host = get_host(plugin_id)
        if host is None:
            raise HTTPException(
                status_code=404, detail=f"Unknown plugin: {plugin_id}"
            )

        # Entitlement check — uses _caller_user_id / _caller_role injected
        # by the dispatcher's auth block.  Lazy import so test patches on
        # the entitlements module take effect at call time.
        from stitch_backend.domains.plugin_distribution.entitlements import (
            get_effective_entitlements,
            is_entitled_to,
        )

        entitlements = await get_effective_entitlements(caller_user_id, caller_role)
        if not is_entitled_to(plugin_id, entitlements):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Not entitled to plugin: {plugin_id}",
            )

    # Strip internal dispatcher keys, then forward caller identity so
    # plugins can scope rows by owner (parallel to totp_dual / mail_dual).
    params = {k: v for k, v in body.items() if not k.startswith("_")}
    params["caller_user_id"] = body.get("_caller_user_id")
    params["caller_role"] = body.get("_caller_role")

    # Host-served metrics: short-circuit before the RPC call so the
    # child process is not touched (the host tracks counters around
    # call()).  Entitlement still applies — only entitled callers see
    # plugin metrics.  The shape is fixed by the runtime contract.
    # For sandbox hosts, the owner already bypassed the entitlement gate
    # above, so metrics are served directly.
    if cmd == "metrics":
        return host.get_metrics()

    try:
        return await host.call(cmd, params)
    except PluginCallTimeout:
        logger.warning("Plugin '%s' command '%s' timed out", plugin_id, cmd)
        raise HTTPException(
            status_code=504,
            detail=f"Plugin '{plugin_id}' command '{cmd}' timed out",
        ) from None
    except PluginNotRunning:
        raise HTTPException(
            status_code=400,
            detail=f"Plugin '{plugin_id}' is not running",
        ) from None
    except RpcCallError as exc:
        logger.warning("Plugin '%s' command '%s' error: %s", plugin_id, cmd, exc)
        raise HTTPException(
            status_code=400,
            detail=f"Plugin '{plugin_id}' error: {exc}",
        ) from exc


@register_command("list_service_plugins", readonly=True)
async def _list_service_plugins(params: dict[str, Any]) -> list[dict[str, Any]]:
    """List installed service plugins with manifest metadata.

    Returns a list of ``{id, version, status, ui, i18n, commands}`` for
    each registered service-plugin host.  ``status`` comes from the
    host/supervisor; ``ui``/``i18n``/``commands`` come from the
    manifest's ``contributions`` field.
    """
    result: list[dict[str, Any]] = []
    for host in all_hosts():
        manifest = get_manifest(host.plugin_id)
        contributions = manifest.contributions if manifest else {}
        result.append({
            "id": host.plugin_id,
            "version": manifest.version if manifest else "0.0.0",
            "status": host.status(),
            "ui": contributions.get("ui", {}),
            "i18n": contributions.get("i18n", {}),
            "commands": contributions.get("commands", []),
            "source": host.source,
            # Capability negotiation (additive field): the plugin's
            # declared capabilities + the host's supported list, so the
            # frontend can gate UI on what the runtime actually offers.
            "capabilities": host.capabilities,
            "supported": list(SUPPORTED_CAPABILITIES),
        })
    return result


@register_command("restart_service_plugin", admin_only=True)
async def _restart_service_plugin(params: dict[str, Any]) -> dict[str, Any]:
    """Restart a service-plugin host (admin-only).

    Stops the host (graceful RPC shutdown + kill-tree) then starts it
    again.  Returns the new status dict from ``host.start()``.
    """
    plugin_id = params.get("plugin_id")
    if not isinstance(plugin_id, str) or not _PLUGIN_ID_RE.match(plugin_id):
        raise HTTPException(
            status_code=400, detail="plugin_id is required and must be valid"
        )
    host = get_host(plugin_id)
    if host is None:
        raise HTTPException(
            status_code=404, detail=f"Unknown plugin: {plugin_id}"
        )
    return await host.restart()


@register_command("get_service_plugin_logs", readonly=True, admin_only=True)
async def _get_service_plugin_logs(params: dict[str, Any]) -> list[str]:
    """Return the last N lines from a plugin host's stderr ring buffer.

    Admin-only, readonly.  Returns ``[]`` when the host has not captured
    any stderr output (not started, child wrote nothing, or ring buffer
    empty).
    """
    plugin_id = params.get("plugin_id")
    if not isinstance(plugin_id, str) or not _PLUGIN_ID_RE.match(plugin_id):
        raise HTTPException(
            status_code=400, detail="plugin_id is required and must be valid"
        )
    host = get_host(plugin_id)
    if host is None:
        raise HTTPException(
            status_code=404, detail=f"Unknown plugin: {plugin_id}"
        )
    lines = params.get("lines", 100)
    if not isinstance(lines, int) or lines < 0:
        lines = 100
    return host.get_logs(lines)
