"""Host-side stdio JSON-RPC 2.0 client (``RpcPluginClient``).  Import via ``autoreg.plugin.rpc``."""

from __future__ import annotations

import collections
import json
import logging
import os
import queue
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .rpc import (
    _ERR_INTERNAL,
    _JSONRPC,
    RpcCallError,
    RpcProtocolError,
    RpcTimeoutError,
)
from .rpc_reverse import _ReverseRpcMixin

# Pinned name: tests capture these warnings under the "autoreg.plugin.rpc" logger.
logger = logging.getLogger("autoreg.plugin.rpc")

# Bounds in-flight reverse-RPC requests; the reader refuses overflow instead of blocking.
_REVERSE_POOL_WORKERS = 4
_STDERR_TAIL_MAX = 200


class RpcWriteTimeoutError(RpcProtocolError):
    """Write to child stdin exceeded ``_write_timeout`` (child stdin wedged)."""


def _make_request(rid: int, method: str, params: dict[str, Any]) -> str:
    """Serialize a JSON-RPC 2.0 request to a single line."""
    return json.dumps(
        {"jsonrpc": _JSONRPC, "id": rid, "method": method, "params": params},
        ensure_ascii=False,
    )


class _PendingCall:
    """A single in-flight call waiting for its response by id."""

    __slots__ = ("id", "event", "result", "error")

    def __init__(self, rid: int) -> None:
        self.id = rid
        self.event = threading.Event()
        self.result: Any = None
        self.error: BaseException | None = None


class RpcPluginClient(_ReverseRpcMixin):
    """Stdio JSON-RPC 2.0 client for a service-plugin child process.

    Lifecycle: ``start(cmd, init_params=...)`` → ``call(name, params)`` →
    ``shutdown()``.  On timeout the child is killed and ``RpcTimeoutError``
    is raised.  Concurrent calls are correlated by id via a threaded reader.

    Zone-1: plain stdlib only.
    """

    def __init__(
        self, *, default_timeout: float = 30.0, write_timeout: float = 5.0
    ) -> None:
        self._default_timeout = default_timeout
        self._write_timeout = write_timeout
        self._proc: subprocess.Popen[bytes] | None = None
        self._reader: threading.Thread | None = None
        self._next_id = 1
        self._id_lock = threading.Lock()
        self._pending: dict[int, _PendingCall] = {}
        self._pending_lock = threading.Lock()
        # Condition over _pending_lock: fires when the last in-flight call completes (event-driven drain).
        self._pending_drained = threading.Condition(self._pending_lock)
        self._write_lock = threading.Lock()
        self._closed = False
        self._init_result: Any = None
        # Reverse RPC: handlers for plugin→host requests (engine.oauth.* etc.)
        self._request_handlers: dict[str, Any] = {}
        # _reverse_slots caps in-flight reverse-RPC requests so the reader never blocks on saturation.
        self._reverse_pool = ThreadPoolExecutor(
            max_workers=_REVERSE_POOL_WORKERS, thread_name_prefix="rpc-reverse"
        )
        self._reverse_slots = threading.BoundedSemaphore(_REVERSE_POOL_WORKERS)
        # Bounded reply queue drained by one daemon writer; the reader only enqueues.
        self._reply_queue: queue.Queue[dict[str, Any] | None] = queue.Queue(maxsize=64)
        self._reply_thread: threading.Thread | None = None
        self._reply_thread_lock = threading.Lock()
        # Ring buffer for plugin.log notifications; maxlen evicts old entries automatically.
        self._structured_logs: collections.deque[dict[str, Any]] = (
            collections.deque(maxlen=1000)
        )
        self._structured_logs_lock = threading.Lock()
        self._stderr_tail: collections.deque[str] = collections.deque(
            maxlen=_STDERR_TAIL_MAX
        )
        self._stderr_thread: threading.Thread | None = None

    @property
    def init_result(self) -> Any:
        """Result of the ``plugin.init`` handshake (set by ``start``/``attach``)."""
        return self._init_result

    @property
    def is_alive(self) -> bool:
        """True if the child process is still running."""
        return self._proc is not None and self._proc.poll() is None

    def get_stderr_tail(self, lines: int = 100) -> list[str]:
        """Return the last *lines* child stderr lines captured by ``start()``.

        Empty when stderr was not piped by this client (``attach()`` path)
        or the child wrote nothing.
        """
        snapshot = list(self._stderr_tail)
        if lines <= 0:
            return snapshot
        return snapshot[-lines:] if lines < len(snapshot) else snapshot

    # ── public API ───────────────────────────────────────────────────────

    def start(
        self,
        cmd: list[str],
        *,
        init_params: dict[str, Any] | None = None,
        timeout: float | None = None,
        env: dict[str, str] | None = None,
    ) -> Any:
        """Spawn child, start reader, perform ``plugin.init`` handshake.

        Returns the init result (also available as ``.init_result``).
        Raises ``RpcTimeoutError`` / ``RpcProtocolError`` on handshake failure
        (child is killed before raising).

        ``start()`` is test-only (production spawns go through
        :class:`SidecarSupervisor`).  It delegates the attach sequence to
        :meth:`attach` so there is a single code path for set-_proc,
        start-reader, handshake, and (optional) ``_migrate_db``.
        """
        if self._proc is not None:
            raise RuntimeError("client already started")

        # NOTE: test-only spawn; a production path here must replicate SidecarSupervisor's _CHILD_ENV_ALLOWLIST.
        child_env = {**os.environ, **env} if env else None
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=child_env,
            )
        except OSError as exc:
            raise RpcProtocolError(f"failed to spawn child: {exc}") from exc

        self._stderr_thread = threading.Thread(
            target=self._stderr_loop, args=(proc,), name="rpc-stderr", daemon=True
        )
        self._stderr_thread.start()
        return self.attach(proc, init_params=init_params, timeout=timeout)

    def attach(
        self,
        proc: subprocess.Popen[bytes],
        *,
        init_params: dict[str, Any] | None = None,
        timeout: float | None = None,
        migrate: bool = False,
    ) -> Any:
        """Attach to an already-spawned child and perform the init handshake.

        Single code path for both :class:`ServicePluginHost` (production) and
        the runtool playground (dev).  Steps:

        1. Set ``_proc`` / ``_closed`` state.
        2. Start the reader thread.
        3. Run the ``plugin.init`` handshake (sets ``.init_result``).
        4. When *migrate* is True, call the reserved ``_migrate_db`` method
           with ``{"from_version": 0, "to_version": 1}``.

        On **handshake** failure (``RpcTimeoutError`` / ``RpcProtocolError``)
        the child is killed and the error is re-raised — same failure path
        as :meth:`start`.  On **_migrate_db** failure the error propagates
        without killing (the handshake already succeeded; the caller decides
        whether to continue or clean up — the runtool playground treats
        migration failure as non-fatal).

        Returns the init result (also available as ``.init_result``).
        Raises ``RuntimeError`` if the client already has a proc attached.
        """
        if self._proc is not None:
            raise RuntimeError("client already started")

        self._closed = False
        self._proc = proc
        self._reader = threading.Thread(
            target=self._reader_loop, name="rpc-reader", daemon=True
        )
        self._reader.start()

        to = timeout if timeout is not None else self._default_timeout
        try:
            self._init_result = self._call_internal(
                "plugin.init", init_params or {}, timeout=to
            )
        except (RpcTimeoutError, RpcProtocolError):
            self.kill()
            raise
        if migrate:
            self.call(
                "_migrate_db",
                {"from_version": 0, "to_version": 1},
                timeout=to,
            )
        return self._init_result

    def call(
        self,
        name: str,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Any:
        """Send ``plugin.call`` with ``{name, params}`` and wait for result."""
        if self._proc is None:
            raise RuntimeError("client not started")
        if self._closed:
            raise RpcProtocolError("client is shutting down")
        to = timeout if timeout is not None else self._default_timeout
        return self._call_internal(
            "plugin.call",
            {"name": name, "params": params or {}},
            timeout=to,
        )

    def ping(self, timeout: float | None = None) -> bool:
        """Send ``plugin.ping``; return ``True`` on success."""
        if self._proc is None:
            raise RuntimeError("client not started")
        if self._closed:
            raise RpcProtocolError("client is shutting down")
        to = timeout if timeout is not None else self._default_timeout
        self._call_internal("plugin.ping", {}, timeout=to)
        return True

    def shutdown(self, *, drain_timeout: float = 5.0) -> None:
        """Graceful shutdown: drain in-flight, send ``plugin.shutdown``, wait."""
        if self._proc is None:
            return
        self._closed = True

        # Event-driven drain: fires when _pending empties; _closed rejects new calls, so the set only shrinks.
        with self._pending_drained:
            deadline = time.monotonic() + drain_timeout
            while self._pending:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._pending_drained.wait(timeout=remaining)

        rid = self._next_request_id()
        try:
            self._send_request(rid, "plugin.shutdown", {})
        except RpcProtocolError:
            pass

        try:
            self._proc.wait(timeout=max(drain_timeout, 1.0))
        except subprocess.TimeoutExpired:
            self.kill()
            return

        self._finalize()

    def kill(self) -> None:
        """Force-kill the child process and clean up."""
        if self._proc is None:
            return
        self._closed = True
        proc = self._proc
        try:
            proc.kill()
        except OSError:
            pass
        try:
            proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            pass
        self._finalize()

    # ── internal ─────────────────────────────────────────────────────────

    def _next_request_id(self) -> int:
        with self._id_lock:
            rid = self._next_id
            self._next_id += 1
            return rid

    def _call_internal(
        self, method: str, params: dict[str, Any], *, timeout: float
    ) -> Any:
        """Send a request and wait for its response by id."""
        rid = self._next_request_id()
        pending = _PendingCall(rid)
        with self._pending_lock:
            self._pending[rid] = pending

        try:
            self._send_request(rid, method, params)
        except RpcProtocolError as exc:
            with self._pending_lock:
                self._pending.pop(rid, None)
                self._notify_drained_locked()
            if isinstance(exc, RpcWriteTimeoutError):
                self.kill()
            raise exc

        if not pending.event.wait(timeout=timeout):
            with self._pending_lock:
                self._pending.pop(rid, None)
                self._notify_drained_locked()
            self.kill()
            raise RpcTimeoutError(
                f"call {method} (id={rid}) timed out after {timeout}s"
            )

        if pending.error is not None:
            raise pending.error
        return pending.result

    def _send_request(self, rid: int, method: str, params: dict[str, Any]) -> None:
        """Write a JSON-RPC request line to child stdin."""
        data = (_make_request(rid, method, params) + "\n").encode("utf-8")
        self._write_bytes(data)

    def _write_bytes(self, data: bytes) -> None:
        """Write *data* to child stdin, bounded by ``_write_timeout``.

        A wedged child with a full pipe would otherwise block the caller
        forever, so the write runs on a daemon thread and raises
        ``RpcWriteTimeoutError`` (a ``RpcProtocolError``) when it does not
        complete in time.  The writer thread holds ``_write_lock`` so a late
        write cannot interleave.
        """
        done = threading.Event()
        errors: list[BaseException] = []

        def _writer() -> None:
            with self._write_lock:
                proc = self._proc
                if proc is None or proc.stdin is None:
                    errors.append(RpcProtocolError("child stdin not available"))
                    done.set()
                    return
                try:
                    proc.stdin.write(data)
                    proc.stdin.flush()
                except (BrokenPipeError, OSError, ValueError) as exc:
                    errors.append(exc)
                finally:
                    done.set()

        threading.Thread(target=_writer, name="rpc-write", daemon=True).start()
        if not done.wait(timeout=self._write_timeout):
            raise RpcWriteTimeoutError(
                f"write to child stdin timed out after {self._write_timeout}s"
            )
        if errors:
            exc = errors[0]
            if isinstance(exc, RpcProtocolError):
                raise exc
            raise RpcProtocolError(
                f"failed to write to child stdin: {exc}"
            ) from exc

    def _stderr_loop(self, proc: subprocess.Popen[bytes]) -> None:
        """Drain child stderr into a bounded tail so the pipe never fills."""
        stream = proc.stderr
        if stream is None:
            return
        try:
            for raw in iter(stream.readline, b""):
                self._stderr_tail.append(
                    raw.decode("utf-8", errors="replace").rstrip("\r\n")
                )
        except Exception as exc:  # noqa: BLE001 — pipe closed / process dead
            logger.debug("rpc: stderr drain stopped: %s", exc)

    def _reader_loop(self) -> None:
        """Reader thread: reads lines from child stdout, routes by id."""
        proc = self._proc
        if proc is None or proc.stdout is None:
            return
        try:
            while True:
                raw = proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                self._handle_line(line)
        except Exception as exc:  # noqa: BLE001 -- best-effort reader
            logger.warning("rpc: reader loop stopped on error: %s", exc, exc_info=True)
        finally:
            self._fail_all_pending(
                RpcProtocolError("child stdout closed (process exited)")
            )

    def _handle_line(self, line: str) -> None:
        """Parse one line from child stdout and route it.

        A line is either:
          - a **response** (has ``id`` + ``result`` or ``error``, no
            ``method``) → routed to the pending call by id;
          - a **request** (has ``method`` + ``id``, no ``result``/``error``)
            → reverse-RPC: dispatched to a registered request handler.
        """
        try:
            obj = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            logger.warning("rpc: skipping malformed line from child: %r", line)
            return

        if not isinstance(obj, dict):
            logger.warning("rpc: skipping non-object line: %r", line)
            return

        # plugin.log notification (no id) goes to the ring buffer; handled before the id check.
        method = obj.get("method")
        if method == "plugin.log" and "id" not in obj:
            self._handle_plugin_log(obj.get("params", {}))
            return

        rid = obj.get("id")
        if rid is None:
            logger.debug("rpc: ignoring non-response line: %r", line)
            return

        try:
            rid_int = int(rid)
        except (TypeError, ValueError):
            logger.warning("rpc: skipping line with non-integer id: %r", line)
            return

        has_result = "result" in obj
        has_error = "error" in obj and obj["error"] is not None

        # Reverse RPC: plugin→host request (has method, no result/error).
        if method is not None and not has_result and not has_error:
            params = obj.get("params", {})
            if not isinstance(params, dict):
                params = {}
            self._handle_plugin_request(rid_int, method, params)
            return

        if not has_result and not has_error:
            logger.warning(
                "rpc: skipping malformed response (no result/error): %r", line
            )
            return

        with self._pending_lock:
            pending = self._pending.pop(rid_int, None)
            self._notify_drained_locked()

        if pending is None:
            logger.debug("rpc: response for unknown id %d: %r", rid_int, line)
            return

        if has_error:
            err = obj["error"]
            if isinstance(err, dict):
                code = err.get("code", _ERR_INTERNAL)
                msg = err.get("message", "unknown error")
                data = err.get("data")
            else:
                code = _ERR_INTERNAL
                msg = str(err)
                data = None
            pending.error = RpcCallError(code, msg, data)
        else:
            pending.result = obj["result"]

        pending.event.set()

    def _fail_all_pending(self, error: BaseException) -> None:
        """Fail all in-flight pending calls with the given error."""
        with self._pending_lock:
            items = list(self._pending.items())
            self._pending.clear()
            self._notify_drained_locked()
        for _, pending in items:
            pending.error = error
            pending.event.set()

    def _notify_drained_locked(self) -> None:
        """Signal drain waiters when the pending set became empty.

        Must be called under ``_pending_lock`` (the drain condition's
        underlying lock), right after entries were removed from
        ``_pending``.  No-op when something is still in flight.
        """
        if not self._pending:
            self._pending_drained.notify_all()

    def _finalize(self) -> None:
        """Join reader thread, shut down reverse-RPC pool, close pipes."""
        if self._reader is not None and self._reader.is_alive():
            self._reader.join(timeout=2.0)
        if self._stderr_thread is not None and self._stderr_thread.is_alive():
            self._stderr_thread.join(timeout=2.0)
        self._stop_reply_writer()
        # N1: wait=False never blocks teardown on a hung handler; workers are daemon-backed.
        try:
            self._reverse_pool.shutdown(wait=False)
        except Exception:  # noqa: BLE001 — best-effort during teardown
            pass
        self._fail_all_pending(RpcProtocolError("client finalized"))
        self._close_pipes()

    def _close_pipes(self) -> None:
        """Close stdin/stdout pipes on the child.

        On Windows, closing ``proc.stdout`` while the reader thread is
        blocked in ``readline()`` deadlocks: a pending synchronous ReadFile
        on a pipe cannot be cancelled by closing the handle from another
        thread (the close blocks until the read returns, which never happens
        while a spawned grandchild still holds the write end).  When the
        reader is still alive we leave stdout open — the daemon reader
        observes EOF once the child's process tree is killed by the
        supervisor's kill-tree and unblocks naturally.
        """
        proc = self._proc
        if proc is None:
            return
        if proc.stdin is not None:
            try:
                proc.stdin.close()
            except OSError:
                pass
        reader_blocked = self._reader is not None and self._reader.is_alive()
        if proc.stdout is not None and not reader_blocked:
            try:
                proc.stdout.close()
            except OSError:
                pass
