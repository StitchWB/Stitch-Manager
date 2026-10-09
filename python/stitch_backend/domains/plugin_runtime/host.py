"""ServicePluginHost — out-of-process plugin lifecycle over SidecarSupervisor.

Each host registers a ``SidecarSpec`` (stdio=``pipes``) with the
process-wide :class:`SidecarSupervisor`.  The supervisor spawns the
child as a ``subprocess.Popen`` with stdin/stdout/stderr PIPE handles
and process-group isolation.  The host then attaches an
:class:`RpcPluginClient` to the supervisor-spawned process (reader
thread + ``plugin.init`` handshake), monitors for crashes, and
restarts once.  Kill always goes through the supervisor's
``_terminate_tree`` (kill-tree), never through the RPC client.

Zone-2: depends on ``stitch_backend`` (supervisor) and
``autoreg.plugin.rpc`` (RPC client).  No plugin code is imported into
the server process.
"""

from __future__ import annotations

import asyncio
import collections
import logging
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from autoreg.plugin.rpc import (
    RpcCallError,
    RpcPluginClient,
    RpcProtocolError,
    RpcTimeoutError,
)
from stitch_backend.core.spi_builtin_oauth import (
    register_engine_handlers as register_engine_handlers,
)
from stitch_backend.domains.plugin_runtime import (
    host_attach,
    host_capabilities,
    host_lifecycle,
    host_logs,
    host_metrics,
    host_resources,
    host_rpc,
    host_spec,
)
from stitch_backend.domains.plugin_runtime.host_capabilities import (
    SUPPORTED_CAPABILITIES,
)
from stitch_backend.domains.plugin_runtime.host_errors import (
    PluginCallTimeout,
    PluginNotRunning,
)
from stitch_backend.domains.sidecar import (
    LaunchPlan as LaunchPlan,
)
from stitch_backend.domains.sidecar import (
    SidecarSpec,
    get_supervisor,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)


class ServicePluginHost:
    """Manages one service-plugin subprocess via the SidecarSupervisor.

    The supervisor owns the process (spawn + kill-tree).  The host owns
    the RPC protocol (handshake, calls, ping) and the crash-restart
    policy (restart-once).
    """

    def __init__(
        self,
        plugin_id: str,
        *,
        entry_module: str | None = None,
        package_dir: Path | None = None,
        command: list[str] | None = None,
        data_dir: Path | None = None,
        migrations: bool = False,
        default_timeout: float = 30.0,
        env: dict[str, str] | None = None,
        source: str = "local",
        host_driver: bool = False,
        memory_limit_mb: int | None = None,
        sidecar_name: str | None = None,
    ) -> None:
        if command is None:
            if entry_module is None:
                raise ValueError("either command or entry_module must be provided")
            command = [sys.executable, "-m", entry_module]
        self.plugin_id = plugin_id
        # Custom sidecar_name avoids supervisor namespace collisions for per-user sandbox hosts.
        self.sidecar_name = sidecar_name or f"plugin:{plugin_id}"
        self._command = command
        self._cwd = str(package_dir) if package_dir else None
        self._env = dict(env) if env else {}
        self.data_dir = data_dir or (
            Path.home() / ".local" / "share" / "stitch-manager"
            / "data" / "plugins" / plugin_id
        )
        self.db_path = self.data_dir / "plugin.db"
        self.migrations = migrations
        # Community/sandbox plugins get a 5s max timeout cap (unsigned subprocesses).
        self.source = source
        self.host_driver = host_driver
        if source in ("community", "sandbox") and not self.host_driver:
            default_timeout = min(default_timeout, 5.0)
        self.default_timeout = default_timeout
        self.memory_limit_mb = memory_limit_mb

        self.supervisor = get_supervisor()
        self.rpc = RpcPluginClient(default_timeout=default_timeout)
        self._restart_count = 0
        self._stopping = False

        self._crash_loop = False
        # Set once on either crash-loop path; cleared on start() — lets consumers await terminal state.
        self._crash_loop_event = asyncio.Event()
        # Test hook: env delay for deterministic restart observation; prod unchanged at 0.
        self._restart_delay_s: float = float(
            os.environ.get("STITCH_PLUGIN_RESTART_DELAY_S", "0") or 0
        )
        # Invoked once on crash-loop via its own task; wired by discovery for telemetry + LKG rollback.
        self.crash_hook: Callable[[ServicePluginHost], Awaitable[None]] | None = None
        self._monitor_task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()

        self._log_buffer: collections.deque[str] = collections.deque(maxlen=1000)
        self._stderr_thread: threading.Thread | None = None

        # Capabilities from plugin.init; empty until handshake — host keeps unknowns for observability.
        self._capabilities: list[str] = []

        # Thread-safe metrics: call() runs via asyncio.to_thread so concurrent calls possible.
        self._metrics_lock = threading.Lock()
        self._metrics_calls: int = 0
        self._metrics_errors: int = 0
        self._metrics_latency_ms: float = 0.0
        self._metrics_last_error: str | None = None
        self._metrics_by_command: dict[str, dict[str, int]] = {}

        # Best-effort resource accounting (peak memory + cumulative CPU).
        self._peak_memory_mb: float | None = None
        self._total_cpu_s: float | None = None
        # POSIX RUSAGE_CHILDREN baseline: delta at death gives this child's resource usage.
        self._rusage_baseline: Any = None

    # ── public API ─────────────────────────────────────────────────────

    async def start(self) -> dict[str, Any]:
        """Register spec, spawn via supervisor, attach RPC, start monitor."""
        async with self._lock:
            if self._stopping:
                return self.status()
            # Already running with an attached RPC client — no-op.
            if self.rpc.is_alive:
                return self.status()
            # Re-register spec on every start: LKG rollback replaces the old instance's spec.
            self.supervisor.register(self._make_spec())
            result = await self.supervisor.start(self.sidecar_name)
            if result["status"] != "running":
                return result
            proc = self.supervisor.get_process(self.sidecar_name)
            if proc is None or not isinstance(proc, subprocess.Popen):
                await self.supervisor.stop(self.sidecar_name)
                return {"status": "error", "error": "expected Popen process",
                        "port": None, "pid": None, "uptimeSeconds": None}
            try:
                self._attach_rpc(proc)
            except (RpcTimeoutError, RpcProtocolError) as exc:
                await self.supervisor.stop(self.sidecar_name)
                return {"status": "error", "error": str(exc),
                        "port": None, "pid": None, "uptimeSeconds": None}
            self._restart_count = 0
            self._crash_loop = False
            self._crash_loop_event.clear()
            self._stopping = False
            self._monitor_task = asyncio.create_task(
                self._monitor(), name=f"plugin-monitor:{self.plugin_id}"
            )
            logger.info("[Plugin:%s] started", self.plugin_id)
            st = self.status()
            # Force running/error=None: crash-after-init must not race supervisor liveness probe into a false 'error'.
            st["status"] = "running"
            st["error"] = None
            # Override pid from our Popen — supervisor status() would re-probe and miss it.
            st["pid"] = proc.pid
            return st

    async def stop(self) -> dict[str, Any]:
        """Graceful RPC shutdown, then supervisor kill-tree."""
        async with self._lock:
            self._stopping = True
            if self._monitor_task and not self._monitor_task.done():
                self._monitor_task.cancel()
                self._monitor_task = None
            # Try graceful RPC shutdown (sends plugin.shutdown, waits).
            try:
                await asyncio.to_thread(self.rpc.shutdown, drain_timeout=3.0)
            except Exception:  # noqa: BLE001
                pass
            # Kill-tree via supervisor (on_stop hook finalizes RPC client).
            result = await self.supervisor.stop(self.sidecar_name)
            logger.info("[Plugin:%s] stopped", self.plugin_id)
            return result

    async def stop_forced(self) -> dict[str, Any]:
        """Kill-tree stop without a graceful RPC shutdown attempt.

        ``stop()`` asks the plugin to exit via ``plugin.shutdown`` first; a
        cooperative child then exits BEFORE the supervisor's kill-tree runs,
        so ``_stop_locked`` sees a dead direct child and skips the tree kill
        — orphaning any descendants the child spawned.  This variant goes
        straight to the supervisor kill-tree (process group on POSIX, Job
        Object + taskkill on Windows), which is the correct primitive when
        the whole tree must die.
        """
        async with self._lock:
            self._stopping = True
            if self._monitor_task and not self._monitor_task.done():
                self._monitor_task.cancel()
                self._monitor_task = None
            result = await self.supervisor.stop(self.sidecar_name)
            logger.info("[Plugin:%s] stopped (forced)", self.plugin_id)
            return result

    async def restart(self) -> dict[str, Any]:
        """Stop the host then start it again (admin restart command).

        ``stop()`` sets ``_stopping = True`` so the crash monitor does not
        race the shutdown.  ``start()`` checks that flag and returns early
        if set — so restart must clear it before re-starting.
        """
        await self.stop()
        self._stopping = False
        return await self.start()

    async def call(
        self, cmd_name: str, params: dict | None = None, timeout: float | None = None
    ) -> Any:
        """Call a plugin command.  Raises PluginCallTimeout on timeout.

        Every call is instrumented for host-served metrics: timing,
        success/error classification, and per-command counters.  Errors
        counted: PluginCallTimeout, RpcCallError, PluginNotRunning.
        """
        to = timeout or self.default_timeout
        if self._stopping or not self.rpc.is_alive:
            self._record_call(cmd_name, 0.0, error="plugin not running")
            raise PluginNotRunning(self.plugin_id)
        start = time.perf_counter()
        try:
            result = await asyncio.to_thread(self.rpc.call, cmd_name, params or {}, to)
        except RpcTimeoutError as exc:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            self._record_call(
                cmd_name, elapsed_ms, error=f"timeout after {to}s"
            )
            raise PluginCallTimeout(self.plugin_id, cmd_name, to) from exc
        except RpcProtocolError as exc:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            self._record_call(cmd_name, elapsed_ms, error="rpc protocol error")
            raise PluginNotRunning(self.plugin_id) from exc
        except RpcCallError as exc:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            self._record_call(cmd_name, elapsed_ms, error=str(exc))
            raise
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        self._record_call(cmd_name, elapsed_ms)
        return result

    async def ping(self, timeout: float | None = None) -> bool:
        to = timeout or self.default_timeout
        if self._stopping or not self.rpc.is_alive:
            return False
        try:
            await asyncio.to_thread(self.rpc.ping, to)
            return True
        except (RpcTimeoutError, RpcProtocolError):
            return False

    def status(self) -> dict[str, Any]:
        sup = self.supervisor.status(self.sidecar_name)
        # Crash-loop host reports explicit error even when supervisor holds dead handle.
        if self._crash_loop and sup.get("status") != "running":
            sup = {
                **sup,
                "status": "error",
                "error": (
                    f"crash loop: host dead after {self._restart_count} restart(s)"
                ),
            }

        with self._metrics_lock:
            calls = self._metrics_calls
            errors = self._metrics_errors
        return {
            **sup,
            "plugin_id": self.plugin_id,
            "restarts": self._restart_count,
            "stopping": self._stopping,
            "source": self.source,
            "supported": list(SUPPORTED_CAPABILITIES),
            "capabilities": list(self._capabilities),
            "calls": calls,
            "errors": errors,
        }

    @property
    def capabilities(self) -> list[str]:
        """Capabilities the plugin declared in its init result (a copy).

        Empty until the handshake completes; backward-compatible ``[]``
        for plugins that predate the capability handshake.
        """
        return list(self._capabilities)

    def get_logs(self, lines: int = 100) -> list[str]:
        """Return the last *lines* entries from the stderr ring buffer.

        Returns an empty list when no logs have been captured (host not
        started, child wrote nothing to stderr, or ring buffer empty).
        """
        snapshot = list(self._log_buffer)
        if lines <= 0:
            return snapshot
        return snapshot[-lines:] if lines < len(snapshot) else snapshot

    def get_structured_logs(self, lines: int = 100) -> list[dict[str, Any]]:
        """Return the last *lines* structured log entries from the ring buffer.

        Structured logs are emitted by the plugin via ``server.log()``
        (a ``plugin.log`` JSON-RPC notification on the stdout channel).
        Each entry is a dict with ``level``, ``message``, ``timestamp``
        and optional ``extra``.  Returns an empty list when the plugin
        has not emitted any structured logs (plugin does not support
        structured logging, or has not called ``server.log()``).
        """
        return self.rpc.get_structured_logs(lines)

    def get_metrics(self) -> dict[str, Any]:
        """Return host-served call metrics (no RPC roundtrip)."""
        return host_metrics.metrics_snapshot(self)

    def _record_call(
        self, cmd_name: str, elapsed_ms: float, *, error: str | None = None
    ) -> None:
        host_metrics.record_call(self, cmd_name, elapsed_ms, error=error)

    @staticmethod
    def _parse_capabilities(init_result: Any) -> list[str]:
        return host_capabilities.parse_capabilities(init_result)

    # ── plugin-to-plugin reverse-RPC ───────────────────────────────────

    def _register_plugin_rpc_handler(self) -> None:
        host_rpc.register_plugin_rpc_handler(self)

    # ── internal ───────────────────────────────────────────────────────

    def _make_spec(self) -> SidecarSpec:
        return host_spec.make_spec(self)

    def _apply_memory_caps_best_effort(
        self, proc: subprocess.Popen[bytes]
    ) -> None:
        host_resources.apply_memory_caps_best_effort(self, proc)

    def _read_resource_usage_at_death(
        self, proc: subprocess.Popen[bytes]
    ) -> None:
        host_resources.read_resource_usage_at_death(self, proc)

    def _attach_rpc(
        self, proc: subprocess.Popen[bytes], timeout: float = 10.0
    ) -> Any:
        return host_attach.attach_rpc(self, proc, timeout)

    def _stderr_reader(self) -> None:
        host_logs.stderr_reader(self)

    async def _monitor(self) -> None:
        await host_lifecycle.monitor(self)

    async def _restart_once(self) -> None:
        await host_lifecycle.restart_once(self)

    async def _run_crash_hook(self) -> None:
        await host_lifecycle.run_crash_hook(self)


__all__ = [
    "ServicePluginHost",
    "PluginCallTimeout",
    "PluginNotRunning",
]
