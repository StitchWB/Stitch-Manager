"""Crash-monitor + restart-once lifecycle loop for a plugin host."""

from __future__ import annotations

import asyncio
import logging
import subprocess
from typing import TYPE_CHECKING

from autoreg.plugin.rpc import RpcProtocolError, RpcTimeoutError

if TYPE_CHECKING:
    from stitch_backend.domains.plugin_runtime.host import ServicePluginHost

logger = logging.getLogger(__name__)


async def monitor(host: ServicePluginHost) -> None:
    """Background task: detect crashes, restart once, then mark dead.

    Loops so the RESTARTED child is monitored too: the first crash
    triggers the restart-once, the second consecutive crash marks the
    host dead and fires the crash hook (telemetry + LKG rollback).
    """
    # Track consecutive crashes per plugin id (todo 23 LKG bookkeeping).
    from stitch_backend.domains.plugin_runtime.lkg import record_crash

    while True:
        try:
            proc = host.supervisor.get_process(host.sidecar_name)
            if proc is None:
                return
            if isinstance(proc, subprocess.Popen):
                await asyncio.to_thread(proc.wait)
            else:
                await proc.wait()
        except asyncio.CancelledError:
            return
        except Exception:  # noqa: BLE001
            return

        if host._stopping:
            return

        record_crash(host.plugin_id)

        # Best-effort resource accounting at death; failures swallowed at debug.
        if isinstance(proc, subprocess.Popen):
            host._read_resource_usage_at_death(proc)

        # Test hook: env delay for deterministic restart observation; only on first restart, outside lock.
        if host._restart_count == 0:
            while host._restart_delay_s > 0:
                if host._stopping:
                    return
                await asyncio.sleep(0.05)

        crash_loop = False
        async with host._lock:
            if host._stopping:
                return
            if host._restart_count >= 1:
                logger.warning(
                    "[Plugin:%s] crashed again after restart — marking dead",
                    host.plugin_id,
                )
                host._crash_loop = True
                host._crash_loop_event.set()
                crash_loop = True
            else:
                await host._restart_once()

        # Crash hook runs in its own task so it can stop this host without interrupting the monitor.
        if crash_loop:
            asyncio.create_task(
                host._run_crash_hook(),
                name=f"plugin-crash-hook:{host.plugin_id}",
            )
            return
        # Otherwise keep watching the restarted child.


async def restart_once(host: ServicePluginHost) -> None:
    """Restart the child via the supervisor after a crash (restart-once).

    Called with ``host._lock`` held.
    """
    host._restart_count += 1
    logger.info("[Plugin:%s] crashed — restarting once", host.plugin_id)
    # Clean up old RPC client pipes.
    try:
        host.rpc._finalize()
    except Exception:  # noqa: BLE001
        pass
    # Process already dead — no _stop_locked/on_stop triggered.
    result = await host.supervisor.start(host.sidecar_name, force=True)
    if result["status"] != "running":
        logger.error("[Plugin:%s] restart failed: %s", host.plugin_id, result)
        return
    new_proc = host.supervisor.get_process(host.sidecar_name)
    if new_proc is None or not isinstance(new_proc, subprocess.Popen):
        return
    try:
        host._attach_rpc(new_proc)
    except (RpcTimeoutError, RpcProtocolError) as exc:
        # RPC handshake failed on fresh process — kill the tree and mark crash-loop to avoid phantom "running".
        logger.error(
            "[Plugin:%s] restart handshake failed: %s — killing new process",
            host.plugin_id, exc,
        )
        try:
            host.rpc._finalize()
        except Exception:  # noqa: BLE001
            pass
        await host.supervisor.stop(host.sidecar_name)
        host._crash_loop = True
        host._crash_loop_event.set()


async def run_crash_hook(host: ServicePluginHost) -> None:
    """Invoke the crash hook (telemetry + LKG rollback) without leaking errors."""
    hook = host.crash_hook
    if hook is None:
        return
    try:
        await hook(host)
    except Exception as exc:  # noqa: BLE001 — hook must not kill the runtime
        logger.warning(
            "[Plugin:%s] crash hook failed: %s", host.plugin_id, exc
        )
