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
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from autoreg.plugin.rpc import (
    RpcCallError,
    RpcPluginClient,
    RpcProtocolError,
    RpcTimeoutError,
)
from stitch_backend.core.spi_builtin_oauth import register_engine_handlers
from stitch_backend.domains.sidecar import LaunchPlan, SidecarSpec, get_supervisor
from stitch_backend.domains.sidecar.supervisor import subprocess_isolation_kwargs

logger = logging.getLogger(__name__)


#: Capabilities the host advertises in the ``plugin.init`` handshake params
#: under the ``supported`` key.  Extensible string list — a plugin reads
#: this to know which host-side features it may rely on:
#:   - ``reverse_rpc``    : the host wires ``engine.oauth.*`` reverse-RPC
#:                          handlers (plugin can call_host).
#:   - ``caller_identity``: the host forwards ``caller_user_id`` /
#:                          ``caller_role`` on every dispatched command.
#:
#: Plugins respond with their own ``capabilities`` list in the init result
#: (see :meth:`ServicePluginHost._parse_capabilities`); unknown values are
#: logged at WARNING and kept verbatim for observability.
SUPPORTED_CAPABILITIES: list[str] = ["reverse_rpc", "caller_identity"]


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
        migrations: bool = False,
        default_timeout: float = 30.0,
        env: dict[str, str] | None = None,
        source: str = "local",
        memory_limit_mb: int | None = None,
        sidecar_name: str | None = None,
    ) -> None:
        if command is None:
            if entry_module is None:
                raise ValueError("either command or entry_module must be provided")
            command = [sys.executable, "-m", entry_module]
        self.plugin_id = plugin_id
        # Allow a custom sidecar name so per-user sandbox hosts (keyed by
        # ``(user_id, plugin_id)``) don't collide on the supervisor's
        # ``plugin:<plugin_id>`` namespace.  Defaults to the standard name
        # for non-sandbox hosts (unchanged behaviour).
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
        # Sandbox caps for community-origin AND sandbox plugins: stricter 5s
        # call timeout (unsigned subprocesses running on the server).  The
        # cap is a maximum — an explicit smaller timeout is respected.
        self.source = source
        if source in ("community", "sandbox"):
            default_timeout = min(default_timeout, 5.0)
        self.default_timeout = default_timeout
        self.memory_limit_mb = memory_limit_mb

        self.supervisor = get_supervisor()
        self.rpc = RpcPluginClient(default_timeout=default_timeout)
        self._restart_count = 0
        self._stopping = False
        #: Set True when the host dies after its restart-once (crash loop).
        #: Surfaced via status() as an error + restarts (degraded state).
        self._crash_loop = False
        #: Test hook (env ``STITCH_PLUGIN_RESTART_DELAY_S``, default 0 = no
        #: delay): delays the monitor's restart after death detection so
        #: the built-in fallback can be observed deterministically.  Read
        #: per-tick by :meth:`_monitor` so a running test can lower it to
        #: release the restart.  Production behavior is unchanged when
        #: unset (0.0) — the delay loop never executes.
        self._restart_delay_s: float = float(
            os.environ.get("STITCH_PLUGIN_RESTART_DELAY_S", "0") or 0
        )
        #: Invoked (as an awaitable) once when the host crash-loops.  Wired
        #: by discovery to telemetry + LKG rollback (todo 23).  Runs in its
        #: own task — never awaited while the host lock is held.
        self.crash_hook: Callable[["ServicePluginHost"], Awaitable[None]] | None = None
        self._monitor_task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        # Ring buffer for child stderr lines — used by get_service_plugin_logs.
        # maxlen bounds memory; old lines are evicted automatically.
        self._log_buffer: collections.deque[str] = collections.deque(maxlen=1000)
        self._stderr_thread: threading.Thread | None = None

        # Capability negotiation: capabilities the plugin declared in its
        # plugin.init result.  Empty until the handshake completes; the
        # host never filters values it does not recognise (it logs a
        # warning and keeps them so status() stays observability-complete).
        self._capabilities: list[str] = []

        # Per-host call metrics — thread-safe because call() runs via
        # asyncio.to_thread(self.rpc.call, ...) and the bridge may issue
        # concurrent calls.  Counters are integers; latency is summed in
        # milliseconds (float) and divided by calls for the average.
        # by_command tracks calls + errors per command name.
        self._metrics_lock = threading.Lock()
        self._metrics_calls: int = 0
        self._metrics_errors: int = 0
        self._metrics_latency_ms: float = 0.0
        self._metrics_last_error: str | None = None
        self._metrics_by_command: dict[str, dict[str, int]] = {}

    # ── public API ─────────────────────────────────────────────────────

    async def start(self) -> dict[str, Any]:
        """Register spec, spawn via supervisor, attach RPC, start monitor."""
        async with self._lock:
            if self._stopping:
                return self.status()
            # Already running with an attached RPC client — no-op.
            if self.rpc.is_alive:
                return self.status()
            # Always (re-)register this host's spec: an LKG rollback starts
            # a NEW host instance under the same sidecar name, and the old
            # instance's spec (old package dir) must be replaced.
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
        except RpcTimeoutError:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            self._record_call(
                cmd_name, elapsed_ms, error=f"timeout after {to}s"
            )
            raise PluginCallTimeout(self.plugin_id, cmd_name, to)
        except RpcProtocolError:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            self._record_call(cmd_name, elapsed_ms, error="rpc protocol error")
            raise PluginNotRunning(self.plugin_id)
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
        # Degraded state (todo 23): a host that died after its restart-once
        # is reported as an explicit crash-loop error (with restarts) even
        # if the supervisor still holds the dead process handle.
        if self._crash_loop and sup.get("status") != "running":
            sup = {
                **sup,
                "status": "error",
                "error": (
                    f"crash loop: host dead after {self._restart_count} restart(s)"
                ),
            }
        # Cheap metrics snapshot (ints only — no copy of by_command, which
        # would mutate under concurrent calls).  The full metrics shape
        # is served by get_metrics() / plugin.{id}.metrics.
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

    def get_metrics(self) -> dict[str, Any]:
        """Return host-served call metrics (no RPC roundtrip).

        Shape (fixed contract — served by ``plugin.{id}.metrics`` and
        the ``service_plugin_metrics`` admin command):

            {
              "calls": int,
              "errors": int,
              "avg_latency_ms": float,
              "last_error": str | None,
              "by_command": {name: {"calls": int, "errors": int}},
            }

        ``avg_latency_ms`` is 0.0 when no calls have been made.
        """
        with self._metrics_lock:
            calls = self._metrics_calls
            errors = self._metrics_errors
            latency = self._metrics_latency_ms
            last_error = self._metrics_last_error
            by_command = {
                name: {"calls": s["calls"], "errors": s["errors"]}
                for name, s in self._metrics_by_command.items()
            }
        avg = (latency / calls) if calls else 0.0
        return {
            "calls": calls,
            "errors": errors,
            "avg_latency_ms": avg,
            "last_error": last_error,
            "by_command": by_command,
        }

    def _record_call(
        self, cmd_name: str, elapsed_ms: float, *, error: str | None = None
    ) -> None:
        """Record one call outcome under the metrics lock (thread-safe).

        ``error`` is the human-readable failure reason (command name is
        embedded by the caller via ``cmd_name``).  Per-command counters
        are kept under ``by_command``; the global ``last_error`` carries
        the most recent failure string (None when the last call succeeded).
        """
        with self._metrics_lock:
            self._metrics_calls += 1
            self._metrics_latency_ms += elapsed_ms
            slot = self._metrics_by_command.setdefault(
                cmd_name, {"calls": 0, "errors": 0}
            )
            slot["calls"] += 1
            if error is not None:
                self._metrics_errors += 1
                slot["errors"] += 1
                self._metrics_last_error = f"{cmd_name}: {error}"
            else:
                self._metrics_last_error = None

    @staticmethod
    def _parse_capabilities(init_result: Any) -> list[str]:
        """Extract the ``capabilities`` list from a plugin.init result.

        Tolerant contract:
          - Missing key / None / non-list value → ``[]`` (backward compat
            with plugins that predate the capability handshake).
          - Non-string entries are dropped (defensive — the contract is
            ``list[str]``).
          - Unknown capability strings (not in :data:`SUPPORTED_CAPABILITIES`)
            are logged at WARNING and kept verbatim — the host never
            silently drops a declared capability.
        """
        if not isinstance(init_result, dict):
            return []
        raw = init_result.get("capabilities")
        if not isinstance(raw, list):
            return []
        known = set(SUPPORTED_CAPABILITIES)
        out: list[str] = []
        for item in raw:
            if not isinstance(item, str) or not item:
                continue
            if item not in known:
                logger.warning(
                    "[Plugin] init result declares unknown capability %r "
                    "(kept for observability)", item,
                )
            out.append(item)
        return out

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
        """Assign the child process to a Job Object with a memory limit.

        Handle lifecycle (leak fix): EVERY handle opened here is closed
        before returning — on success and on every failure path.  The job
        handle is closed AFTER ``AssignProcessToJobObject`` succeeds:
        closing it does NOT remove the process from the job.  A job object
        kernel object stays alive (with its limits enforced) while any
        process is a member, regardless of open handles — the assignment
        is what binds the process, not the handle.  Verified on Windows:
        ``IsProcessInJob`` still returns TRUE after the job handle is
        closed (see ``test_windows_job_cap_membership_survives_handle_close``
        in test_plugin_host.py).  Keeping the handle alive instead would
        leak one kernel handle per attach/restart until the cap silently
        stops applying.

        The child is assigned via a real process handle (``OpenProcess``)
        — ``AssignProcessToJobObject`` takes a HANDLE, not a PID.
        """
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]

        # JobObjectExtendedLimitInformation = 9
        JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100
        PROCESS_ALL_ACCESS = 0x1FFFFF

        # Proper types: default ctypes restype (c_int) truncates handles
        # on 64-bit Windows.
        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        kernel32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.OpenProcess.argtypes = [
            wintypes.DWORD, wintypes.BOOL, wintypes.DWORD,
        ]
        kernel32.SetInformationJobObject.argtypes = [
            wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD,
        ]
        kernel32.AssignProcessToJobObject.argtypes = [
            wintypes.HANDLE, wintypes.HANDLE,
        ]
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

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
        try:
            info = _JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
            info.ProcessMemoryLimit = limit_bytes

            ok = kernel32.SetInformationJobObject(
                h_job, 9, ctypes.byref(info), ctypes.sizeof(info)
            )
            if not ok:
                raise ctypes.WinError()  # type: ignore[attr-defined]

            h_proc = kernel32.OpenProcess(PROCESS_ALL_ACCESS, False, proc.pid)
            if not h_proc:
                raise ctypes.WinError()  # type: ignore[attr-defined]
            try:
                ok = kernel32.AssignProcessToJobObject(h_job, h_proc)
                if not ok:
                    raise ctypes.WinError()  # type: ignore[attr-defined]
            finally:
                kernel32.CloseHandle(h_proc)
        finally:
            # Safe to close: the assignment survives handle closure (see
            # docstring).  On failure paths this releases the job object
            # immediately instead of leaking it.
            kernel32.CloseHandle(h_job)

        logger.info(
            "[Plugin:%s] memory cap %dMB applied via Job Object",
            self.plugin_id, self.memory_limit_mb,
        )

    def _attach_rpc(
        self, proc: subprocess.Popen[bytes], timeout: float = 10.0
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
        self.data_dir.mkdir(parents=True, exist_ok=True)
        # Host-specific: memory caps BEFORE attach.
        self._apply_memory_caps_best_effort(proc)
        init_params = {
            "engine_api": 2,
            "plugin_id": self.plugin_id,
            "data_dir": str(self.data_dir),
            "db_path": str(self.db_path),
            # Capability negotiation: advertise the host-side features
            # the plugin may rely on.  Plugins echo back their own
            # ``capabilities`` list in the init result (optional).
            "supported": list(SUPPORTED_CAPABILITIES),
        }
        self.rpc = RpcPluginClient(default_timeout=self.default_timeout)
        # Common sequence: set _proc, start reader, plugin.init handshake,
        # _migrate_db (when self.migrations is True).
        self.rpc.attach(
            proc,
            init_params=init_params,
            timeout=timeout,
            migrate=self.migrations,
        )
        # Host-specific: register engine.oauth.* reverse-RPC handlers AFTER
        # attach.
        register_engine_handlers(self.rpc)
        # Host-specific: parse capabilities from the init result AFTER attach.
        self._capabilities = self._parse_capabilities(
            self.rpc.init_result
        )
        # Host-specific: stderr reader AFTER attach.
        if proc.stderr is not None:
            self._stderr_thread = threading.Thread(
                target=self._stderr_reader,
                name=f"plugin-stderr:{self.plugin_id}",
                daemon=True,
            )
            self._stderr_thread.start()
        return self.rpc.init_result

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
        """Background task: detect crashes, restart once, then mark dead.

        Loops so the RESTARTED child is monitored too: the first crash
        triggers the restart-once, the second consecutive crash marks the
        host dead and fires the crash hook (telemetry + LKG rollback).
        """
        # Track consecutive crashes per plugin id (todo 23 LKG bookkeeping).
        from stitch_backend.domains.plugin_runtime.lkg import record_crash

        while True:
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

            record_crash(self.plugin_id)

            # Test hook (STITCH_PLUGIN_RESTART_DELAY_S): hold the restart
            # so the built-in fallback can be observed deterministically.
            # Read per-tick so a running test can lower the attribute to
            # release the restart.  Only delays the first restart
            # (restart_count == 0); the crash-loop path (second crash)
            # fires the hook immediately.  Outside the lock so stop() can
            # cancel the monitor during the hold.
            if self._restart_count == 0:
                while self._restart_delay_s > 0:
                    if self._stopping:
                        return
                    await asyncio.sleep(0.05)

            crash_loop = False
            async with self._lock:
                if self._stopping:
                    return
                if self._restart_count >= 1:
                    logger.warning(
                        "[Plugin:%s] crashed again after restart — marking dead",
                        self.plugin_id,
                    )
                    self._crash_loop = True
                    crash_loop = True
                else:
                    await self._restart_once()

            # Fire the crash hook (telemetry + LKG rollback) as its own task:
            # it may stop THIS host, which cancels the monitor task — that
            # must not interrupt the hook mid-flight, and the host lock is
            # already released.
            if crash_loop:
                asyncio.create_task(
                    self._run_crash_hook(),
                    name=f"plugin-crash-hook:{self.plugin_id}",
                )
                return
            # Otherwise keep watching the restarted child.

    async def _restart_once(self) -> None:
        """Restart the child via the supervisor after a crash (restart-once).

        Called with ``self._lock`` held.
        """
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
            # M5: the supervisor just spawned a fresh process, but the RPC
            # handshake failed.  Without cleanup the new child would keep
            # running with a detached RPC client (zombie state).  Kill the
            # new process tree via the supervisor and mark the host as
            # crash-looped so status() surfaces a clean error instead of a
            # phantom "running" process with no attached RPC.
            logger.error(
                "[Plugin:%s] restart handshake failed: %s — killing new process",
                self.plugin_id, exc,
            )
            try:
                self.rpc._finalize()
            except Exception:  # noqa: BLE001
                pass
            await self.supervisor.stop(self.sidecar_name)
            self._crash_loop = True

    async def _run_crash_hook(self) -> None:
        """Invoke the crash hook (telemetry + LKG rollback) without leaking errors."""
        hook = self.crash_hook
        if hook is None:
            return
        try:
            await hook(self)
        except Exception as exc:  # noqa: BLE001 — hook must not kill the runtime
            logger.warning(
                "[Plugin:%s] crash hook failed: %s", self.plugin_id, exc
            )


__all__ = [
    "ServicePluginHost",
    "PluginCallTimeout",
    "PluginNotRunning",
]
