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

    Zone-1: plain stdlib only (no stitch_backend imports, no third-party).
    """

    def __init__(self) -> None:
        self._handlers: dict[str, Any] = {}
        self._init_handler: Any = None
        # Reverse RPC state.
        self._request_handlers: dict[str, Any] = {}
        self._next_request_id = 1
        # Lock guards the id counter from re-entrancy (signal/nested loop) tearing its read-modify-write.
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

        Stdin/stdout are reconfigured to UTF-8 first: on Windows they
        default to the console codepage (cp1251 etc.), where the first
        non-ASCII response or request param kills the child with a
        UnicodeEncodeError/UnicodeDecodeError while the host-side pipe
        speaks UTF-8 anyway.
        """
        for stream in (sys.stdin, sys.stdout):
            reconfigure = getattr(stream, "reconfigure", None)
            if reconfigure is None:
                continue
            try:
                reconfigure(encoding="utf-8")
            except (OSError, ValueError):
                pass
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


from .rpc_client import RpcPluginClient

__all__ = [
    "RpcCallError",
    "RpcError",
    "RpcPluginClient",
    "RpcPluginServer",
    "RpcProtocolError",
    "RpcTimeoutError",
]
