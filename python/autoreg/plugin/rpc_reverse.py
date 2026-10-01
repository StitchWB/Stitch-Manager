"""Reverse-RPC (plugin→host) dispatch and structured-log ring buffer for RpcPluginClient."""

from __future__ import annotations

import json
import logging
from typing import Any

from .rpc import _ERR_INTERNAL, _JSONRPC

# Pinned name: tests capture these warnings under the "autoreg.plugin.rpc" logger.
logger = logging.getLogger("autoreg.plugin.rpc")


class _ReverseRpcMixin:
    """Reverse-RPC + structured-log half of ``RpcPluginClient``.

    The attributes used here (``_proc``, ``_write_lock``,
    ``_request_handlers``, ``_reverse_pool``, ``_structured_logs``,
    ``_structured_logs_lock``) are initialized in
    ``RpcPluginClient.__init__``.
    """

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
            # Pool shut down during finalize — drop the request; the plugin is going down anyway.
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
                # N2: child gone or stdin closed; the reader loop surfaces the failure to pending calls.
                logger.warning(
                    "rpc: _write_line pipe error for response id=%r: %s", rid, exc
                )
