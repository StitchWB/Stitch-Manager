"""plugin.call_plugin reverse-RPC wiring (plugin-to-plugin calls via the host)."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from stitch_backend.domains.plugin_runtime.host import ServicePluginHost


def register_plugin_rpc_handler(host: ServicePluginHost) -> None:
    """Register the ``plugin.call_plugin`` reverse-RPC handler.

    Lets this host's plugin call another plugin's command at runtime
    via ``call_host("plugin.call_plugin", {target, command, params})``.
    The host mediates the call and enforces the permission boundary:
    the ``target`` MUST be listed in the caller's manifest ``depends``
    (after stripping ``@range`` via :func:`parse_dep_entry`).  This
    prevents a plugin from calling arbitrary plugins it did not declare
    a dependency on.

    The handler is sync (required by
    :meth:`RpcPluginClient.set_request_handler`); it bridges to the
    async :meth:`ServicePluginHost.call` on the target host via
    ``asyncio.run`` (no existing event loop in the reverse-RPC worker
    thread — same pattern as ``engine.oauth.*`` handlers in
    :func:`register_engine_handlers`).

    Errors are raised as exceptions; the RPC layer
    (:meth:`RpcPluginClient._run_plugin_request`) catches them and
    returns a JSON-RPC error response to the calling plugin:

      - :class:`PermissionError` — target not in caller's depends, or
        caller has no registered manifest.
      - :class:`RuntimeError` — target plugin not running.
      - :class:`PluginCallTimeout` / :class:`PluginNotRunning` /
        :class:`RpcCallError` — forwarded from the target host's
        ``call`` (propagated through ``asyncio.run``).
    """
    from autoreg.plugin.dependency_resolver import parse_dep_entry
    from stitch_backend.domains.plugin_runtime import get_host, get_manifest

    caller_plugin_id = host.plugin_id

    def _call_plugin(params: dict[str, Any]) -> Any:
        target = str(params.get("target", ""))
        command = str(params.get("command", ""))
        call_params = params.get("params", {})
        if not isinstance(call_params, dict):
            call_params = {}

        if not target or not command:
            raise ValueError(
                "plugin.call_plugin requires 'target' and 'command'"
            )

        # Target must be in caller's depends list; strip @range via parse_dep_entry.
        manifest = get_manifest(caller_plugin_id)
        if manifest is None:
            raise PermissionError(
                f"plugin {caller_plugin_id!r} has no registered manifest; "
                f"plugin_rpc denied"
            )
        dep_ids = {parse_dep_entry(d)[0] for d in manifest.depends}
        if target not in dep_ids:
            raise PermissionError(
                f"plugin {caller_plugin_id!r} cannot call plugin "
                f"{target!r}: not in declared depends "
                f"{sorted(dep_ids) or '[]'}"
            )

        # Resolve target host.
        target_host = get_host(target)
        if target_host is None or not target_host.rpc.is_alive:
            raise RuntimeError(
                f"target plugin {target!r} is not running"
            )

        # Bridge async target_host.call via asyncio.run (sync reverse-RPC handler, no existing loop).
        return asyncio.run(target_host.call(command, call_params))

    host.rpc.set_request_handler("plugin.call_plugin", _call_plugin)
