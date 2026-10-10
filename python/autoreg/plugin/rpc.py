"""Stdio JSON-RPC 2.0 protocol for service plugins (plan todo 2).

Line-delimited JSON-RPC 2.0 over child stdin/stdout.  Concurrent calls are
correlated by request id via a threaded reader.  Malformed lines from the
child are skipped+logged -- they never crash the host.

Zone-1: plain stdlib only (no stitch_backend imports, no third-party deps).
"""

from __future__ import annotations

import json
import sys
import threading
import time
from typing import Any

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

    Jobs: long-running work runs via ``start_job(fn)`` on a daemon
    thread (the serve loop stays serial); ``register_job_commands()``
    adds the ``list_jobs`` / ``get_job`` / ``cancel_job`` polling
    commands, and progress is emitted as ``plugin.job_progress``
    notifications.  Every stdout line write (responses, notifications,
    reverse-RPC requests) is serialized by an output lock so job
    threads never interleave partial lines.

    Zone-1: plain stdlib only (no stitch_backend imports, no third-party).
    """

    _JOB_HISTORY_MAX = 50

    def __init__(self) -> None:
        self._handlers: dict[str, Any] = {}
        self._init_handler: Any = None
        # Reverse RPC state.
        self._request_handlers: dict[str, Any] = {}
        self._next_request_id = 1
        # Lock guards the id counter from re-entrancy (signal/nested loop) tearing its read-modify-write.
        self._request_id_lock = threading.Lock()
        self._queued_lines: list[str] = []
        # Single reader thread owns stdin; serve() and call_host() drain this buffer.
        self._inbound: list[str | None] = []
        self._inbound_cv = threading.Condition()
        self._reader_eof = False
        self._reader_thread: threading.Thread | None = None
        # Pinned at serve() start: a plugin's long action may swap sys.stdout process-wide.
        self._stdin: Any = None
        self._stdout: Any = None
        self._jobs: dict[str, dict[str, Any]] = {}
        self._jobs_lock = threading.Lock()
        # Serializes every stdout line write (serve thread + job threads).
        self._output_lock = threading.Lock()

    def _input_stream(self) -> Any:
        return self._stdin if self._stdin is not None else sys.stdin

    def _output_stream(self) -> Any:
        return self._stdout if self._stdout is not None else sys.stdout

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

        Called from inside a command handler.  Writes the request to
        stdout, then drains the reader thread's inbound buffer until the
        matching response arrives.  Host→plugin requests that arrive while
        waiting are queued for the serve loop to process after the current
        handler returns.

        Raises ``RpcTimeoutError`` if the response does not arrive within
        *timeout* seconds, or ``RpcProtocolError`` if stdin closes.
        """
        rid = self._next_request_id_locked()
        req = {"jsonrpc": _JSONRPC, "id": rid, "method": method,
               "params": params or {}}
        with self._output_lock:
            out = self._output_stream()
            out.write(json.dumps(req, ensure_ascii=False) + "\n")
            out.flush()

        self._ensure_reader()
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RpcTimeoutError(
                    f"call_host {method} (id={rid}) timed out after {timeout}s"
                )
            status, raw = self._next_line(remaining)
            if status == "eof":
                raise RpcProtocolError(
                    "stdin closed while waiting for host response"
                )
            if status == "timeout":
                raise RpcTimeoutError(
                    f"call_host {method} (id={rid}) timed out after {timeout}s"
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

        The timestamp is an ISO 8601 UTC string.  Uses a LOCAL import of
        ``datetime`` + ``UTC`` so the vendored copy (which only ships
        ``json``, ``sys``, ``threading``, ``time``, ``typing`` at module
        level) remains self-contained — the earlier code referenced the
        module-level ``UTC`` alias, which the vendored header does NOT
        import and thus raised ``NameError`` in standalone plugins.
        """
        from datetime import UTC, datetime

        params: dict[str, Any] = {
            "level": level,
            "message": message,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        params.update(extra)
        self._send_notification("plugin.log", params)

    class _JobContext:
        """Execution context handed to a ``start_job`` function."""

        __slots__ = ("_record", "_server")

        def __init__(self, server: RpcPluginServer, record: dict[str, Any]) -> None:
            self._server = server
            self._record = record

        @property
        def job_id(self) -> str:
            return self._record["jobId"]

        @property
        def cancelled(self) -> bool:
            return bool(self._record["cancelled"])

        def report_progress(self, percent: int, message: str) -> None:
            self._server._report_job_progress(self._record, percent, message)

    def start_job(self, fn: Any, *, name: str = "") -> str:
        """Start ``fn(ctx)`` as a background job on a daemon thread.

        Call from a command handler and return the job id: host calls cap
        at ~30s, so long work runs as a job while the host polls the
        commands from :meth:`register_job_commands`.  ``fn`` receives a
        context with ``job_id``, a ``cancelled`` property (flipped by
        ``cancel_job``) and ``report_progress(percent, message)`` which
        updates the job and emits a ``plugin.job_progress`` notification.
        Terminal status is decided when ``fn`` returns: ``done`` with
        ``result`` = return value, ``cancelled`` when it returned after
        ``cancelled`` became True, ``failed`` with ``error`` = str(exc)
        when it raises.
        """
        from datetime import UTC, datetime
        from uuid import uuid4

        job_id = uuid4().hex
        record: dict[str, Any] = {
            "jobId": job_id,
            "name": name,
            "status": "running",
            "percent": 0,
            "message": "",
            "result": None,
            "error": None,
            "startedAt": datetime.now(UTC).isoformat(),
            "finishedAt": None,
            "cancelled": False,
        }
        ctx = self._JobContext(self, record)
        with self._jobs_lock:
            self._jobs[job_id] = record
        threading.Thread(
            target=self._run_job,
            args=(fn, ctx, record),
            name=f"rpc-job-{job_id[:8]}",
            daemon=True,
        ).start()
        return job_id

    def register_job_commands(self) -> None:
        """Register the ``list_jobs`` / ``get_job`` / ``cancel_job`` commands.

        ``list_jobs`` returns ``[{jobId, name, status, percent, message,
        startedAt, finishedAt}]`` newest-first; ``get_job`` (params
        ``{jobId}``) returns ``{jobId, name, status, percent, message,
        result, error}`` with status ``running``/``done``/``failed``/
        ``cancelled`` (unknown id → JSON-RPC error); ``cancel_job``
        (params ``{jobId}``) returns ``{ok: bool}`` and sets the
        cancelled flag only while the job is still running.  At most 50
        finished jobs are kept (oldest dropped).
        """
        self.register("list_jobs", self._cmd_list_jobs)
        self.register("get_job", self._cmd_get_job)
        self.register("cancel_job", self._cmd_cancel_job)

    def _cmd_list_jobs(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        with self._jobs_lock:
            return [
                {
                    "jobId": rec["jobId"],
                    "name": rec["name"],
                    "status": rec["status"],
                    "percent": rec["percent"],
                    "message": rec["message"],
                    "startedAt": rec["startedAt"],
                    "finishedAt": rec["finishedAt"],
                }
                for rec in reversed(self._jobs.values())
            ]

    def _cmd_get_job(self, params: dict[str, Any]) -> dict[str, Any]:
        job_id = params.get("jobId", "")
        with self._jobs_lock:
            rec = self._jobs.get(job_id)
            if rec is None:
                return _error(-32601, f"job not found: {job_id}")
            return {
                "jobId": rec["jobId"],
                "name": rec["name"],
                "status": rec["status"],
                "percent": rec["percent"],
                "message": rec["message"],
                "result": rec["result"],
                "error": rec["error"],
            }

    def _cmd_cancel_job(self, params: dict[str, Any]) -> dict[str, Any]:
        job_id = params.get("jobId", "")
        with self._jobs_lock:
            rec = self._jobs.get(job_id)
            if rec is None or rec["status"] != "running":
                return {"ok": False}
            rec["cancelled"] = True
        return {"ok": True}

    def _run_job(self, fn: Any, ctx: Any, record: dict[str, Any]) -> None:
        """Run one job to a terminal status, then prune finished history."""
        from datetime import UTC, datetime

        try:
            result = fn(ctx)
        except Exception as exc:  # noqa: BLE001 — job failure is a status, not a crash
            with self._jobs_lock:
                record["status"] = "failed"
                record["error"] = str(exc)
                record["finishedAt"] = datetime.now(UTC).isoformat()
                self._prune_finished_locked()
            return
        with self._jobs_lock:
            if record["cancelled"]:
                record["status"] = "cancelled"
            else:
                record["status"] = "done"
                record["result"] = result
            record["finishedAt"] = datetime.now(UTC).isoformat()
            self._prune_finished_locked()

    def _report_job_progress(
        self, record: dict[str, Any], percent: int, message: str
    ) -> None:
        """Update a job's progress and emit a ``plugin.job_progress`` notification."""
        with self._jobs_lock:
            record["percent"] = percent
            record["message"] = message
        self._send_notification(
            "plugin.job_progress",
            {
                "jobId": record["jobId"],
                "percent": percent,
                "message": message,
            },
        )

    def _prune_finished_locked(self) -> None:
        """Drop the oldest finished jobs beyond ``_JOB_HISTORY_MAX``.

        Must be called under ``_jobs_lock``.
        """
        finished = [
            job_id for job_id, rec in self._jobs.items()
            if rec["status"] != "running"
        ]
        excess = len(finished) - self._JOB_HISTORY_MAX
        if excess <= 0:
            return
        for job_id in finished[:excess]:
            del self._jobs[job_id]

    def _send_notification(self, method: str, params: dict[str, Any]) -> None:
        """Write one JSON-RPC notification line under the output lock."""
        line = json.dumps(
            {"jsonrpc": _JSONRPC, "method": method, "params": params},
            ensure_ascii=False,
        )
        out = self._output_stream()
        with self._output_lock:
            out.write(line + "\n")
            out.flush()

    def serve(self) -> None:
        """Main read-dispatch-write loop.  Exits on ``plugin.shutdown``.

        Handlers are dispatched serially: a long-running ``plugin.call``
        handler delays every subsequent request, including ``plugin.ping``
        (host liveness).

        A daemon reader thread owns stdin for the loop's lifetime and
        feeds lines into ``_next_line``; both this loop and ``call_host``
        drain that buffer, so ``call_host`` can enforce a real read
        deadline (there is no ``select`` on Windows pipes).  Before
        reading the next line, any lines queued by ``call_host``
        (host→plugin requests that arrived while waiting for a host
        response) are processed.

        Stdin/stdout are reconfigured to UTF-8 first: on Windows they
        default to the console codepage (cp1251 etc.), where the first
        non-ASCII response or request param kills the child with a
        UnicodeEncodeError/UnicodeDecodeError while the host-side pipe
        speaks UTF-8 anyway.

        Both streams are pinned here so responses keep flowing to the
        host even if a plugin swaps ``sys.stdout`` via
        ``contextlib.redirect_stdout`` for a long action.
        """
        self._stdin = sys.stdin
        self._stdout = sys.stdout
        for stream in (self._stdin, self._stdout):
            reconfigure = getattr(stream, "reconfigure", None)
            if reconfigure is None:
                continue
            try:
                reconfigure(encoding="utf-8")
            except (OSError, ValueError):
                pass
        self._ensure_reader()
        while True:
            # Process lines queued by call_host before reading new ones.
            while self._queued_lines:
                queued = self._queued_lines.pop(0)
                if self._process_line(queued):
                    return  # plugin.shutdown received
            status, raw = self._next_line(None)
            if status == "eof":
                break
            if status == "timeout":
                continue
            line = raw.strip()
            if not line:
                continue
            if self._process_line(line):
                return  # plugin.shutdown received

    def _ensure_reader(self) -> None:
        """Start the stdin reader thread once (idempotent)."""
        if self._reader_thread is not None and self._reader_thread.is_alive():
            return
        self._reader_thread = threading.Thread(
            target=self._reader_loop, name="rpc-server-reader", daemon=True
        )
        self._reader_thread.start()

    def _reader_loop(self) -> None:
        stream = self._input_stream()
        try:
            while True:
                try:
                    raw = stream.readline()
                except (OSError, ValueError):
                    raw = ""
                if not raw:
                    break
                with self._inbound_cv:
                    self._inbound.append(raw)
                    self._inbound_cv.notify_all()
        finally:
            with self._inbound_cv:
                self._reader_eof = True
                self._inbound.append(None)
                self._inbound_cv.notify_all()

    def _next_line(self, timeout: float | None) -> tuple[str, str]:
        """Return one inbound line as ``(status, line)``.

        ``status`` is ``"line"``, ``"eof"``, or ``"timeout"`` — the
        3-state split lets the serve loop (blocks) and ``call_host``
        (bounded) tell a closed stream apart from an expired deadline.
        Loops past spurious wakeups so a bounded caller never times out
        before its deadline actually elapses.
        """
        deadline = None if timeout is None else time.monotonic() + timeout
        with self._inbound_cv:
            while not self._inbound and not self._reader_eof:
                if deadline is None:
                    self._inbound_cv.wait()
                    continue
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return ("timeout", "")
                self._inbound_cv.wait(remaining)
            if self._inbound:
                item = self._inbound.pop(0)
            else:
                return ("eof" if self._reader_eof else "timeout", "")
        if item is None:
            return ("eof", "")
        return ("line", item)

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
        return str(method) == "plugin.shutdown"

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

    def _send_response(self, rid: Any, result: Any) -> None:
        """Write one JSON-RPC response line to the pinned output stream.

        Only a result whose ``error`` is a dict carrying both ``code`` and
        ``message`` (what ``_error`` builds) becomes a JSON-RPC error
        envelope; any other ``error`` value ships as ``result``.  The
        write is serialized with job-thread notifications by
        ``_output_lock``.
        """
        err = result.get("error") if isinstance(result, dict) else None
        if isinstance(err, dict) and "code" in err and "message" in err:
            obj: dict[str, Any] = {"jsonrpc": _JSONRPC, "id": rid, "error": err}
        else:
            obj = {"jsonrpc": _JSONRPC, "id": rid, "result": result}
        out = self._output_stream()
        with self._output_lock:
            out.write(json.dumps(obj, ensure_ascii=False) + "\n")
            out.flush()


def _error(code: int, message: str, data: Any = None) -> dict[str, Any]:
    """Build a JSON-RPC error result for ``_dispatch``."""
    err: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"error": err}


from .rpc_client import RpcPluginClient

__all__ = [
    "RpcCallError",
    "RpcError",
    "RpcPluginClient",
    "RpcPluginServer",
    "RpcProtocolError",
    "RpcTimeoutError",
]
