"""RPC attach + plugin.init handshake for a supervisor-spawned child."""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any

from autoreg.plugin.rpc import RpcPluginClient
from stitch_backend.core.spi_builtin_oauth import register_engine_handlers
from stitch_backend.domains.plugin_runtime import host_resources
from stitch_backend.domains.plugin_runtime.host_capabilities import (
    SUPPORTED_CAPABILITIES,
)

if TYPE_CHECKING:
    import subprocess

    from stitch_backend.domains.plugin_runtime.host import ServicePluginHost


def attach_rpc(
    host: ServicePluginHost, proc: subprocess.Popen[bytes], timeout: float = 10.0
) -> Any:
    """Attach RpcPluginClient to an already-spawned Popen and handshake.

    Delegates the common attach sequence (set _proc, start reader,
    ``plugin.init`` handshake, ``_migrate_db``) to
    :meth:`RpcPluginClient.attach` — the single code path shared with
    the runtool playground.  Host-specific steps are kept explicit and
    ordered around it:

    BEFORE attach:
      - memory caps (the child does no meaningful work before
        plugin.init; capping here bounds the handshake itself).

    AFTER attach:
      - register engine.oauth.* reverse-RPC handlers (the plugin may
        call_host during/after init; handlers must be wired before the
        first plugin.call).  Lives in _attach_rpc rather than start()
        so restart (_restart_once → _attach_rpc) also wires handlers.
      - register plugin.call_plugin reverse-RPC handler (plugin→plugin
        calls; same wiring rationale as engine.oauth.*).
      - parse capabilities from the init result (tolerant: missing/
        non-list → []).  Host-only — the playground does not parse
        capabilities.
      - start stderr reader (host surfaces child logs via
        get_service_plugin_logs; the reader is non-blocking).

    Intentional deltas from runtool._attach_client (documented so the
    next diverger sees them):
      - memory caps: host-only (playground has none).
      - engine.oauth handlers: host registers real handlers (playground
        stubs them via _RunRpcPluginClient._handle_plugin_request).
      - capabilities parsing: host-only (playground does not parse).
      - stderr reader: host starts AFTER attach; playground starts
        BEFORE attach (playground wants init-time stderr visible).
    """
    host.data_dir.mkdir(parents=True, exist_ok=True)
    # Host-specific: memory caps BEFORE attach.
    host._apply_memory_caps_best_effort(proc)
    # POSIX RUSAGE_CHILDREN baseline: delta at death gives this child's CPU + peak RSS.
    host._rusage_baseline = host_resources.snapshot_rusage_children()
    init_params = {
        "engine_api": 2,
        "plugin_id": host.plugin_id,
        "data_dir": str(host.data_dir),
        "db_path": str(host.db_path),
        # Host-side features the plugin may rely on (echoed back in init result).
        "supported": list(SUPPORTED_CAPABILITIES),
    }
    host.rpc = RpcPluginClient(default_timeout=host.default_timeout)

    host.rpc.attach(
        proc,
        init_params=init_params,
        timeout=timeout,
        migrate=host.migrations,
    )
    # Wire engine.oauth.* reverse-RPC handlers after attach.
    register_engine_handlers(host.rpc)
    # Wire plugin.call_plugin reverse-RPC handler (also wired on restart).
    host._register_plugin_rpc_handler()
    # Parse capabilities from init result after attach.
    host._capabilities = host._parse_capabilities(
        host.rpc.init_result
    )
    # Start stderr reader after attach.
    if proc.stderr is not None:
        host._stderr_thread = threading.Thread(
            target=host._stderr_reader,
            name=f"plugin-stderr:{host.plugin_id}",
            daemon=True,
        )
        host._stderr_thread.start()
    return host.rpc.init_result
