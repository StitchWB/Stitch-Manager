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
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from autoreg.plugin.rpc import (
    RpcPluginClient,
    RpcProtocolError,
    RpcTimeoutError,
)
from stitch_backend.domains.sidecar import LaunchPlan, SidecarSpec, get_supervisor
from stitch_backend.domains.sidecar.supervisor import _subprocess_isolation_kwargs

logger = logging.getLogger(__name__)


class PluginCallTimeout(Exception):
    """Plugin command timed out (504-friendly)."""

    def __init__(self, plugin_id: str, command: str, timeout: float) -> None:
        self.plugin_id = plugin_id
        self.command = command
        self.timeout = timeout
        super().__init__(
            f"plugin {plugin_id} command {command!r} timed out after {timeout}s"
        )


class PluginNotRunning(Exception):
    """Plugin host is not running (crashed, not started, or stopping)."""

    def __init__(self, plugin_id: str) -> None:
        self.plugin_id = plugin_id
        super().__init__(f"plugin {plugin_id} is not running")


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
        engine_config: dict[str, Any] | None = None,
        migrations: bool = False,
        default_timeout: float = 30.0,
        env: dict[str, str] | None = None,
        source: str = "local",
        memory_limit_mb: int | None = None,
    ) -> None:
        if command is None:
            if entry_module is None:
                raise ValueError("either command or entry_module must be provided")
            command = [sys.executable, "-m", entry_module]
        self.plugin_id = plugin_id
        self.sidecar_name = f"plugin:{plugin_id}"
        self._command = command
        self._cwd = str(package_dir) if package_dir else None
        self._env = dict(env) if env else {}
        self.data_dir = data_dir or (
            Path.home() / ".local" / "share" / "stitch-manager"
            / "data" / "plugins" / plugin_id
        )
        self.db_path = self.data_dir / "plugin.db"
        self.engine_config = engine_config or {}
        self.migrations = migrations
        # Sandbox caps for community-origin plugins: stricter 5s call timeout
        # (community plugins are unsigned subprocesses).  The cap is a
        # maximum — an explicit smaller timeout is respected.
        self.source = source
        if source == "community":
            default_timeout = min(default_timeout, 5.0)
        self.default_timeout = default_timeout
        self.memory_limit_mb = memory_limit_mb

        self.supervisor = get_supervisor()
        self.rpc = RpcPluginClient(default_timeout=default_timeout)
        self._restart_count = 0
        self._stopping = False
        self._monitor_task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        # Ring buffer for child stderr lines — used by get_service_plugin_logs.
        # maxlen bounds memory; old lines are evicted automatically.
        self._log_buffer: collections.deque[str] = collections.deque(maxlen=1000)
        self._stderr_thread: threading.Thread | None = None

    # ── public API ─────────────────────────────────────────────────────

    async def start(self) -> dict[str, Any]:
        """Register spec, spawn via supervisor, attach RPC, start monitor."""
        async with self._lock:
            if self._stopping:
                return self.status()
            # Already running with an attached RPC client — no-op.
            if self.rpc.is_alive:
                return self.status()
            if not self.supervisor.is_registered(self.sidecar_name):
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
            self._stopping = False
            self._monitor_task = asyncio.create_task(
                self._monitor(), name=f"plugin-monitor:{self.plugin_id}"
            )
            logger.info("[Plugin:%s] started", self.plugin_id)
            return self.status()

    async def stop(self) -> dict[str, Any]:
        """Graceful RPC shutdown, then supervisor kill-tree."""
        async with self._lock:
            self._stopping = True
            if self._monitor_task and not self._monitor_task.done():
                self._monitor_task.cancel()
                self._monitor_task = None
            # Try graceful RPC shutdown (sends plugin.shutdown, waits).
            try:
                await asyncio.to_thread(self.rpc.shutdown, 3.0)
            except Exception:  # noqa: BLE001
                pass
            # Kill-tree via supervisor (on_stop hook finalizes RPC client).
            result = await self.supervisor.stop(self.sidecar_name)
            logger.info("[Plugin:%s] stopped", self.plugin_id)
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
        """Call a plugin command.  Raises PluginCallTimeout on timeout."""
        to = timeout or self.default_timeout
        if self._stopping or not self.rpc.is_alive:
            raise PluginNotRunning(self.plugin_id)
        try:
            return await asyncio.to_thread(self.rpc.call, cmd_name, params or {}, to)
        except RpcTimeoutError:
            raise PluginCallTimeout(self.plugin_id, cmd_name, to)
        except RpcProtocolError:
            raise PluginNotRunning(self.plugin_id)

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
        return {
            **sup,
            "plugin_id": self.plugin_id,
            "restarts": self._restart_count,
            "stopping": self._stopping,
            "source": self.source,
        }

    def get_logs(self, lines: int = 100) -> list[str]:
        """Return the last *lines* entries from the stderr ring buffer.

        Returns an empty list when no logs have been captured (host not
        started, child wrote nothing to stderr, or ring buffer empty).
        """
        snapshot = list(self._log_buffer)
        if lines <= 0:
            return snapshot
        return snapshot[-lines:] if lines < len(snapshot) else snapshot

    # ── internal ───────────────────────────────────────────────────────

    def _make_spec(self) -> SidecarSpec:
        def prepare(_settings: dict | None) -> LaunchPlan:
            return LaunchPlan(
                command=list(self._command),
                cwd=self._cwd,
                env=dict(self._env),
                stdio="pipes",
                config={"plugin_id": self.plugin_id},
            )

        def on_stop() -> None:
            self._stopping = True
            if self._monitor_task and not self._monitor_task.done():
                self._monitor_task.cancel()
            try:
                self.rpc._finalize()
            except Exception:  # noqa: BLE001
                pass

        return SidecarSpec(
            name=self.sidecar_name,
            display_name=f"Plugin: {self.plugin_id}",
            prepare=prepare,
            on_stop=on_stop,
        )

    def _apply_memory_caps_best_effort(
        self, proc: subprocess.Popen[bytes]
    ) -> None:
        """Apply best-effort memory cap to the child process.

        - Windows: assign the process to a Job Object with
          ``JOB_OBJECT_LIMIT_PROCESS_MEMORY`` via ctypes.
        - POSIX (Linux): ``resource.prlimit`` RLIMIT_AS on the child pid.
        - Other platforms / failures: log a warning and continue.

        Called from ``_attach_rpc`` after the supervisor spawns the child.
        Best-effort — never raises.
        """
        if self.memory_limit_mb is None:
            return
        limit_bytes = self.memory_limit_mb * 1024 * 1024
        try:
            if sys.platform == "win32":
                self._apply_windows_job_memory_cap(proc, limit_bytes)
            elif sys.platform == "linux":
                import resource
                resource.prlimit(  # type: ignore[attr-defined]
                    proc.pid,
                    resource.RLIMIT_AS,
                    (limit_bytes, limit_bytes),
                )
                logger.info(
                    "[Plugin:%s] memory cap %dMB applied via prlimit",
                    self.plugin_id, self.memory_limit_mb,
                )
            else:
                logger.warning(
                    "[Plugin:%s] memory cap not supported on %s",
                    self.plugin_id, sys.platform,
                )
        except Exception as exc:  # noqa: BLE001 — best-effort
            logger.warning(
                "[Plugin:%s] memory cap %dMB failed: %s",
                self.plugin_id, self.memory_limit_mb, exc,
            )

    def _apply_windows_job_memory_cap(
        self, proc: subprocess.Popen[bytes], limit_bytes: int
    ) -> None:
        """Assign the child process to a Job Object with a memory limit."""
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]

        # JobObjectExtendedLimitInformation = 9
        JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100

        class _IO_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("ReadOperationCount", ctypes.c_uint64),
                ("WriteOperationCount", ctypes.c_uint64),
                ("OtherOperationCount", ctypes.c_uint64),
                ("ReadTransferCount", ctypes.c_uint64),
                ("WriteTransferCount", ctypes.c_uint64),
                ("OtherTransferCount", ctypes.c_uint64),
            ]

        class _JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", wintypes.LARGE_INTEGER),
                ("PerJobUserTimeLimit", wintypes.LARGE_INTEGER),
                ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_void_p),
                ("PriorityClass", wintypes.DWORD),
                ("SchedulingClass", wintypes.DWORD),
            ]

        class _JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", _JOBOBJECT_BASIC_LIMIT_INFORMATION),
                ("IoInfo", _IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        h_job = kernel32.CreateJobObjectW(None, None)
        if not h_job:
            raise ctypes.WinError()  # type: ignore[attr-defined]

        info = _JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
        info.ProcessMemoryLimit = limit_bytes

        ok = kernel32.SetInformationJobObject(
            h_job, 9, ctypes.byref(info), ctypes.sizeof(info)
        )
        if not ok:
            raise ctypes.WinError()  # type: ignore[attr-defined]

        ok = kernel32.AssignProcessToJobObject(h_job, int(proc.pid))
        if not ok:
            raise ctypes.WinError()  # type: ignore[attr-defined]

        logger.info(
            "[Plugin:%s] memory cap %dMB applied via Job Object",
            self.plugin_id, self.memory_limit_mb,
        )

    def _attach_rpc(
        self, proc: subprocess.Popen[bytes], timeout: float = 10.0
    ) -> Any:
        """Attach RpcPluginClient to an already-spawned Popen and handshake.

        RpcPluginClient.start() spawns its own process; we bypass that by
        setting ``_proc`` directly and starting the reader thread + handshake
        manually.  This reuses the client's id correlation, malformed-line
        skip, and call/ping/shutdown methods without duplicating them.
        """
        self.data_dir.mkdir(parents=True, exist_ok=True)
        # Apply best-effort memory cap before the child does meaningful work.
        self._apply_memory_caps_best_effort(proc)
        init_params = {
            "engine_api": 2,
            "plugin_id": self.plugin_id,
            "data_dir": str(self.data_dir),
            "db_path": str(self.db_path),
            "engine_config": self.engine_config,
        }
        self.rpc = RpcPluginClient(default_timeout=self.default_timeout)
        self.rpc._proc = proc
        self.rpc._closed = False
        self.rpc._reader = threading.Thread(
            target=self.rpc._reader_loop, name="rpc-reader", daemon=True
        )
        self.rpc._reader.start()
        try:
            self.rpc._init_result = self.rpc._call_internal(
                "plugin.init", init_params, timeout=timeout
            )
        except (RpcTimeoutError, RpcProtocolError):
            self.rpc.kill()
            raise
        if self.migrations:
            self.rpc.call(
                "_migrate_db",
                {"from_version": 0, "to_version": 1},
                timeout=timeout,
            )
        # Start a daemon thread that reads child stderr into the ring
        # buffer for get_service_plugin_logs.  The thread exits when the
        # child's stderr pipe closes (process death / stop).
        if proc.stderr is not None:
            self._stderr_thread = threading.Thread(
                target=self._stderr_reader,
                name=f"plugin-stderr:{self.plugin_id}",
                daemon=True,
            )
            self._stderr_thread.start()
        return self.rpc._init_result

    def _stderr_reader(self) -> None:
        """Read child stderr line-by-line into the ring buffer."""
        proc = self.rpc._proc
        if proc is None or getattr(proc, "stderr", None) is None:
            return
        stream = proc.stderr
        try:
            for raw in iter(stream.readline, b""):
                self._log_buffer.append(
                    raw.decode("utf-8", errors="replace").rstrip("\r\n")
                )
        except Exception:  # noqa: BLE001 — pipe closed / process dead
            pass

    async def _monitor(self) -> None:
        """Background task: detect crash, restart once, then mark dead."""
        try:
            proc = self.supervisor.get_process(self.sidecar_name)
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

        if self._stopping:
            return

        async with self._lock:
            if self._stopping:
                return
            if self._restart_count >= 1:
                logger.warning(
                    "[Plugin:%s] crashed again after restart — marking dead",
                    self.plugin_id,
                )
                return
            self._restart_count += 1
            logger.info("[Plugin:%s] crashed — restarting once", self.plugin_id)
            # Clean up old RPC client pipes.
            try:
                self.rpc._finalize()
            except Exception:  # noqa: BLE001
                pass
            # Restart via supervisor (process is already dead, so
            # _stop_locked is not called — no on_stop triggered).
            result = await self.supervisor.start(self.sidecar_name, force=True)
            if result["status"] != "running":
                logger.error("[Plugin:%s] restart failed: %s", self.plugin_id, result)
                return
            new_proc = self.supervisor.get_process(self.sidecar_name)
            if new_proc is None or not isinstance(new_proc, subprocess.Popen):
                return
            try:
                self._attach_rpc(new_proc)
            except (RpcTimeoutError, RpcProtocolError) as exc:
                logger.error("[Plugin:%s] restart handshake failed: %s",
                             self.plugin_id, exc)


__all__ = [
    "ServicePluginHost",
    "PluginCallTimeout",
    "PluginNotRunning",
]
