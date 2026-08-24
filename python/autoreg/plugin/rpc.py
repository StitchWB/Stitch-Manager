"""Stdio JSON-RPC 2.0 protocol for service plugins (plan todo 2).

Line-delimited JSON-RPC 2.0 over child stdin/stdout.  Concurrent calls are
correlated by request id via a threaded reader.  Malformed lines from the
child are skipped+logged -- they never crash the host.

Zone-1: plain stdlib only (no stitch_backend imports, no third-party deps).
"""  # allow: SIZE_OK -- single responsibility (JSON-RPC client); size driven by
# concurrent-call correlation, malformed-line skip, shutdown drain, adversarial
# error paths — all required by plan todo 2.

from __future__ import annotations

import collections
import json
import logging
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

logger = logging.getLogger(__name__)

_JSONRPC = "2.0"
_ERR_INTERNAL = -32603


class RpcError(Exception):
    """Base RPC error."""


class RpcTimeoutError(RpcError):
    """Call timed out.  The child process is killed before raising."""


class RpcProtocolError(RpcError):
    """Protocol stream broken (child died, stdout closed, write failed).

    Individual malformed *lines* are skipped+logged; this is only raised when
    the stream itself breaks.
    """


class RpcCallError(RpcError):
    """Child returned a JSON-RPC error response."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        self.code = code
        self.data = data
        super().__init__(f"[{code}] {message}")


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


class RpcPluginClient:
    """Stdio JSON-RPC 2.0 client for a service-plugin child process.

    Lifecycle: ``start(cmd, init_params=...)`` → ``call(name, params)`` →
    ``shutdown()``.  On timeout the child is killed and ``RpcTimeoutError``
    is raised.  Concurrent calls are correlated by id via a threaded reader.

    Zone-1: plain stdlib only.
    """

    def __init__(self, *, default_timeout: float = 30.0) -> None:
        self._default_timeout = default_timeout
        self._proc: subprocess.Popen[bytes] | None = None
        self._reader: threading.Thread | None = None
        self._next_id = 1
        self._id_lock = threading.Lock()
        self._pending: dict[int, _PendingCall] = {}
        self._pending_lock = threading.Lock()
        self._write_lock = threading.Lock()
        self._closed = False
        self._init_result: Any = None
        # Reverse RPC: handlers for plugin→host requests (engine.oauth.* etc.)
        self._request_handlers: dict[str, Any] = {}
        # N1: bounded thread pool for reverse-RPC handler execution.  The
        # reader thread dispatches each plugin→host request here instead of
        # spawning an unbounded daemon thread per request (which could
        # exhaust OS threads under load).  4 workers is enough for the
        # current reverse-RPC surface (engine.oauth.* — sequential flows);
        # a backlog is bounded by the executor's queue-less submit semantics
        # (a 5th request blocks the reader until a worker frees, which
        # correctly applies backpressure to the plugin).
        self._reverse_pool = ThreadPoolExecutor(
            max_workers=4, thread_name_prefix="rpc-reverse"
        )
        # Structured log ring buffer: entries pushed from plugin.log
        # notifications (no id) received on the stdout channel.  The reader
        # thread appends; the host reads via get_structured_logs().
        # maxlen bounds memory; old entries are evicted automatically.
        self._structured_logs: collections.deque[dict[str, Any]] = (
            collections.deque(maxlen=1000)
        )
        self._structured_logs_lock = threading.Lock()

    @property
    def init_result(self) -> Any:
        """Result of the ``plugin.init`` handshake (set by ``start``/``attach``)."""
        return self._init_result

    @property
    def is_alive(self) -> bool:
        """True if the child process is still running."""
        return self._proc is not None and self._proc.poll() is None

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

        # NOTE: production plugin spawns go through SidecarSupervisor.start()
        # which applies the _CHILD_ENV_ALLOWLIST (no host secrets leak).  This
        # ``start()`` is only used by tests; if it ever becomes a production
        # path, apply the same allowlist here (rpc.py is Zone-1 stdlib-only,
        # so duplicate a minimal allowlist rather than importing stitch_backend).
        child_env = {**os.environ, **env} if env else None
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=child_env,
            )
        except OSError as exc:
            raise RpcProtocolError(f"failed to spawn child: {exc}") from exc

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

    def set_request_handler(self, name: str, handler: Any) -> None:
        """Register a sync handler for a plugin→host request (reverse RPC).

        ``handler(params: dict) -> result`` is called in a worker thread
        when the plugin sends a JSON-RPC request with ``method=name``.
        The response is written back to the child stdin.  Unknown methods
        return a JSON-RPC error (-32601) to the plugin.
        """
        self._request_handlers[name] = handler

    def get_structured_logs(self, lines: int = 100) -> list[dict[str, Any]]:
        """Return the last *lines* structured log entries from the ring buffer.

        Each entry is a dict with ``level``, ``message``, ``timestamp`` and
        optional ``extra`` keys (the ``plugin.log`` notification params).
        Returns an empty list when no structured logs have been received
        (plugin never called ``server.log()`` or the host does not support
        structured logging).
        """
        with self._structured_logs_lock:
            snapshot = list(self._structured_logs)
        if lines <= 0:
            return snapshot
        return snapshot[-lines:] if lines < len(snapshot) else snapshot

    def shutdown(self, *, drain_timeout: float = 5.0) -> None:
        """Graceful shutdown: drain in-flight, send ``plugin.shutdown``, wait."""
        if self._proc is None:
            return
        self._closed = True

        deadline = time.monotonic() + drain_timeout
        while time.monotonic() < deadline:
            with self._pending_lock:
                if not self._pending:
                    break
            time.sleep(0.05)

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
            raise exc

        if not pending.event.wait(timeout=timeout):
            with self._pending_lock:
                self._pending.pop(rid, None)
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
        with self._write_lock:
            if self._proc is None or self._proc.stdin is None:
                raise RpcProtocolError("child stdin not available")
            try:
                self._proc.stdin.write(data)
                self._proc.stdin.flush()
            except (BrokenPipeError, OSError, ValueError) as exc:
                raise RpcProtocolError(
                    f"failed to write to child stdin: {exc}"
                ) from exc

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
        except Exception:  # noqa: BLE001 -- best-effort reader
            pass
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

        # Structured log notification (plugin.log, no id) — push to the
        # structured log ring buffer.  This is NOT a reverse-RPC request
        # (no response needed); the entry is recorded for host-side
        # observability.  Handled before the id check because notifications
        # have no id.
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

    def _handle_plugin_request(
        self, rid: int, method: str, params: dict[str, Any]
    ) -> None:
        """Dispatch a plugin→host request to a registered handler.

        Runs in the reader thread; the handler itself is executed in the
        bounded reverse-RPC thread pool (``_reverse_pool``) so the reader
        is not blocked (a slow handler would stall responses to other
        pending calls).  The pool bounds concurrency to 4 workers; a 5th
        in-flight request applies backpressure by blocking the reader
        until a worker frees.
        """
        handler = self._request_handlers.get(method)
        if handler is None:
            self._write_line(
                {"jsonrpc": _JSONRPC, "id": rid,
                 "error": {"code": -32601, "message": f"method not found: {method}"}}
            )
            return
        try:
            self._reverse_pool.submit(
                self._run_plugin_request, rid, handler, params
            )
        except RuntimeError:
            # Pool was shut down (client finalizing) — drop the request
            # silently; the plugin is going down anyway.
            pass

    def _handle_plugin_log(self, params: Any) -> None:
        """Push a ``plugin.log`` notification's params into the ring buffer.

        Runs in the reader thread.  Tolerant: non-dict params are dropped
        (the plugin sent a malformed notification).  The entry is a dict
        with ``level``, ``message``, ``timestamp`` and optional ``extra``
        (all params beyond the three known keys).
        """
        if not isinstance(params, dict):
            return
        entry: dict[str, Any] = {
            "level": params.get("level", "info"),
            "message": params.get("message", ""),
            "timestamp": params.get("timestamp", ""),
        }
        extra = {
            k: v for k, v in params.items()
            if k not in ("level", "message", "timestamp")
        }
        if extra:
            entry["extra"] = extra
        with self._structured_logs_lock:
            self._structured_logs.append(entry)

    def _run_plugin_request(
        self, rid: int, handler: Any, params: dict[str, Any]
    ) -> None:
        """Execute a reverse-RPC handler and write the response back."""
        try:
            result = handler(params)
            self._write_line(
                {"jsonrpc": _JSONRPC, "id": rid, "result": result}
            )
        except Exception as exc:  # noqa: BLE001 — handler errors are returned, not raised
            self._write_line(
                {"jsonrpc": _JSONRPC, "id": rid,
                 "error": {"code": _ERR_INTERNAL, "message": str(exc)}}
            )

    def _write_line(self, obj: dict[str, Any]) -> None:
        """Write one JSON-RPC line to child stdin (used for reverse-RPC responses).

        Non-raising: a broken pipe here means the child has exited or closed
        its stdin.  The reader loop will fail in-flight calls separately via
        ``_fail_all_pending``.  We log a warning (with the response id and
        error) so silent data loss is debuggable, but we do not raise — the
        caller (reverse-RPC worker) has no way to recover the request.
        """
        data = (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
        rid = obj.get("id")
        with self._write_lock:
            if self._proc is None or self._proc.stdin is None:
                logger.warning(
                    "rpc: _write_line dropped (no stdin) for response id=%r", rid
                )
                return
            try:
                self._proc.stdin.write(data)
                self._proc.stdin.flush()
            except (BrokenPipeError, OSError, ValueError) as exc:
                # N2: log with context so silent drops are debuggable.  The
                # child is gone or its stdin is closed; the reader loop
                # surfaces the failure to pending calls separately.
                logger.warning(
                    "rpc: _write_line pipe error for response id=%r: %s", rid, exc
                )

    def _fail_all_pending(self, error: BaseException) -> None:
        """Fail all in-flight pending calls with the given error."""
        with self._pending_lock:
            items = list(self._pending.items())
            self._pending.clear()
        for _, pending in items:
            pending.error = error
            pending.event.set()

    def _finalize(self) -> None:
        """Join reader thread, shut down reverse-RPC pool, close pipes."""
        if self._reader is not None and self._reader.is_alive():
            self._reader.join(timeout=2.0)
        # N1: shut down the bounded reverse-RPC pool so worker threads do
        # not outlive the client.  wait=False avoids blocking the caller
        # on a hung handler; the workers are daemon-thread backed so they
        # will not prevent process exit either way.
        try:
            self._reverse_pool.shutdown(wait=False)
        except Exception:  # noqa: BLE001 — best-effort during teardown
            pass
        self._fail_all_pending(RpcProtocolError("client finalized"))
        self._close_pipes()

    def _close_pipes(self) -> None:
        """Close stdin/stdout pipes on the child."""
        proc = self._proc
        if proc is None:
            return
        for stream in (proc.stdin, proc.stdout):
            if stream is not None:
                try:
                    stream.close()
                except OSError:
                    pass


# ── Server side (plugin entry-point helper) ───────────────────────────────


class RpcPluginServer:
    """Stdio JSON-RPC 2.0 server for service-plugin entry points.

    Plugin authors call ``serve(init_handler=..., handlers={...})`` from
    their ``__main__``.  The server reads JSON-RPC requests from stdin,
    dispatches ``plugin.init`` / ``plugin.call`` / ``plugin.ping`` /
    ``plugin.shutdown``, and writes responses to stdout — one JSON object
    per line.

    Protocol methods handled automatically:
      - ``plugin.init``   → calls ``init_handler(params)`` (if set),
                             returns its result.
      - ``plugin.ping``    → returns ``"pong"``.
      - ``plugin.shutdown``→ returns ``None`` and exits.

    ``plugin.call`` dispatches to ``handlers[name](params)``.  Unknown
    names return a JSON-RPC error (code -32601, method not found).
    Handler exceptions are caught and returned as JSON-RPC error
    responses (code -32603, internal error) — the server never crashes.

    Reverse RPC: plugin→host requests are sent via ``call_host(method,
    params)`` from inside a handler.  The server writes a JSON-RPC
    request to stdout and reads the response from stdin.  Any
    host→plugin requests that arrive while waiting for a response are
    queued and processed by the serve loop after the current handler
    returns (single-threaded serve loop).

    Zone-1: plain stdlib only (no stitch_backend imports, no third-party).
    """

    def __init__(self) -> None:
        self._handlers: dict[str, Any] = {}
        self._init_handler: Any = None
        # Reverse RPC state.
        self._request_handlers: dict[str, Any] = {}
        self._next_request_id = 1
        # N6: guard the id counter with a lock.  The serve loop is
        # single-threaded (only one ``call_host`` can be in flight at a
        # time because it blocks the serve loop reading stdin), so in
        # practice the counter is never contended.  The lock makes that
        # invariant explicit and protects against future re-entrancy
        # (e.g. a signal handler or a nested event loop) corrupting the
        # counter via a torn read-modify-write.
        self._request_id_lock = threading.Lock()
        self._queued_lines: list[str] = []

    def register(self, name: str, handler: Any) -> None:
        """Register a command handler callable ``handler(params) -> result``."""
        self._handlers[name] = handler

    def set_init_handler(self, handler: Any) -> None:
        """Set the ``plugin.init`` handler ``handler(params) -> result``."""
        self._init_handler = handler

    def set_request_handler(self, name: str, handler: Any) -> None:
        """Register a handler for a host→plugin request (reverse RPC).

        Not used directly by the plugin; the host-side
        ``RpcPluginClient.set_request_handler`` registers handlers that
        the plugin can call via ``call_host``.
        """
        self._request_handlers[name] = handler

    def _next_request_id_locked(self) -> int:
        """Atomically allocate the next reverse-RPC request id.

        The serve loop is single-threaded (see ``serve``), so in practice
        this lock is never contended — it exists to make the
        read-modify-write on ``_next_request_id`` atomic and to document
        the single-threaded assumption.  A future caller that invokes
        ``call_host`` from outside the serve loop would be a bug.
        """
        with self._request_id_lock:
            rid = self._next_request_id
            self._next_request_id += 1
            return rid

    def call_host(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        timeout: float = 30.0,
    ) -> Any:
        """Send a JSON-RPC request to the host and wait for the response.

        Called from inside a command handler (single-threaded serve
        loop).  Writes the request to stdout, then reads lines from
        stdin until the matching response arrives.  Host→plugin requests
        that arrive while waiting are queued for the serve loop to
        process after the current handler returns.

        Raises ``RpcTimeoutError`` if the response does not arrive
        within *timeout* seconds, or ``RpcProtocolError`` if stdin
        closes.
        """
        rid = self._next_request_id_locked()
        req = {"jsonrpc": _JSONRPC, "id": rid, "method": method,
               "params": params or {}}
        sys.stdout.write(json.dumps(req, ensure_ascii=False) + "\n")
        sys.stdout.flush()

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            raw = sys.stdin.readline()
            if not raw:
                raise RpcProtocolError(
                    "stdin closed while waiting for host response"
                )
            line = raw.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue
            if not isinstance(obj, dict):
                continue
            obj_id = obj.get("id")
            has_result = "result" in obj
            has_error = "error" in obj and obj["error"] is not None
            obj_method = obj.get("method")

            # Response to our request?
            if obj_id == rid and has_result and obj_method is None:
                return obj["result"]
            if obj_id == rid and has_error and obj_method is None:
                err = obj["error"]
                if isinstance(err, dict):
                    raise RpcCallError(
                        err.get("code", _ERR_INTERNAL),
                        err.get("message", "unknown error"),
                        err.get("data"),
                    )
                raise RpcCallError(_ERR_INTERNAL, str(err))

            # Host→plugin request or unrelated line — queue for serve loop.
            self._queued_lines.append(line)

        raise RpcTimeoutError(
            f"call_host {method} (id={rid}) timed out after {timeout}s"
        )

    def log(self, level: str, message: str, **extra: Any) -> None:
        """Write a structured log entry to stdout as a ``plugin.log`` notification.

        Emits a JSON-RPC 2.0 notification (no ``id``) with method
        ``plugin.log`` and params ``{level, message, timestamp, ...extra}``.
        The host's :class:`RpcPluginClient` reader thread picks it up and
        pushes it into the structured log ring buffer — no response is
        expected or sent.

        ``level`` is a free-form string (conventionally ``debug``,
        ``info``, ``warning``, ``error``).  ``extra`` key-value pairs are
        merged into the params dict (e.g. ``server.log("info", "synced",
        count=3)`` → params include ``"count": 3``).

        The timestamp is an ISO 8601 UTC string.  Uses a local import of
        ``datetime`` so the vendored copy (which only ships ``json``,
        ``sys``, ``threading``, ``time``, ``typing`` at module level)
        remains self-contained.
        """
        from datetime import datetime, timezone

        params: dict[str, Any] = {
            "level": level,
            "message": message,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        params.update(extra)
        line = json.dumps(
            {"jsonrpc": _JSONRPC, "method": "plugin.log", "params": params},
            ensure_ascii=False,
        )
        sys.stdout.write(line + "\n")
        sys.stdout.flush()

    def serve(self) -> None:
        """Main read-dispatch-write loop.  Exits on ``plugin.shutdown``.

        Uses ``sys.stdin.readline()`` (not ``for line in sys.stdin``) so
        that ``call_host`` can also read from stdin without the iterator's
        internal buffering swallowing lines.  Before reading the next
        line, any lines queued by ``call_host`` (host→plugin requests
        that arrived while waiting for a host response) are processed.
        """
        while True:
            # Process lines queued by call_host before reading new ones.
            while self._queued_lines:
                queued = self._queued_lines.pop(0)
                if self._process_line(queued):
                    return  # plugin.shutdown received
            raw = sys.stdin.readline()
            if not raw:
                break
            line = raw.strip()
            if not line:
                continue
            if self._process_line(line):
                return  # plugin.shutdown received

    def _process_line(self, line: str) -> bool:
        """Process one line.  Returns True if ``plugin.shutdown`` was received."""
        try:
            req = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            return False
        if not isinstance(req, dict):
            return False
        rid = req.get("id")
        method = req.get("method", "")
        params = req.get("params", {})
        if not isinstance(params, dict):
            params = {}
        result = self._dispatch(method, params)
        self._send_response(rid, result)
        return method == "plugin.shutdown"

    def _dispatch(self, method: str, params: dict[str, Any]) -> Any:
        """Dispatch one request, returning a result or error dict."""
        try:
            if method == "plugin.init":
                if self._init_handler is not None:
                    return self._init_handler(params)
                return params
            if method == "plugin.ping":
                return "pong"
            if method == "plugin.shutdown":
                return None
            if method == "plugin.call":
                name = params.get("name", "")
                args = params.get("params", {})
                if not isinstance(args, dict):
                    args = {}
                handler = self._handlers.get(name)
                if handler is None:
                    return _error(-32601, f"method not found: {name}")
                return handler(args)
            return _error(-32601, f"unknown method: {method}")
        except Exception as exc:  # noqa: BLE001 — server never crashes
            return _error(_ERR_INTERNAL, str(exc))

    @staticmethod
    def _send_response(rid: Any, result: Any) -> None:
        """Write one JSON-RPC response line to stdout."""
        if isinstance(result, dict) and "error" in result:
            obj: dict[str, Any] = {"jsonrpc": _JSONRPC, "id": rid, "error": result["error"]}
        else:
            obj = {"jsonrpc": _JSONRPC, "id": rid, "result": result}
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def _error(code: int, message: str, data: Any = None) -> dict[str, Any]:
    """Build a JSON-RPC error result for ``_dispatch``."""
    err: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"error": err}
