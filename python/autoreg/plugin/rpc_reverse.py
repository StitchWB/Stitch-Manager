"""Reverse-RPC (plugin→host) dispatch, structured-log ring buffer and job-progress snapshots for RpcPluginClient."""

from __future__ import annotations

import json
import logging
import queue
import threading
from datetime import UTC, datetime
from typing import Any

from .rpc import _ERR_INTERNAL, _JSONRPC, RpcProtocolError

# JSON-RPC error returned to the plugin when the reverse-RPC pool is saturated.
_ERR_HOST_BUSY = -32000

# Pinned name: tests capture these warnings under the "autoreg.plugin.rpc" logger.
logger = logging.getLogger("autoreg.plugin.rpc")


class _ReverseRpcMixin:
    """Reverse-RPC + structured-log half of ``RpcPluginClient``.

    The attributes used here (``_proc``, ``_write_lock``,
    ``_request_handlers``, ``_reverse_pool``, ``_reply_queue``,
    ``_reply_thread``, ``_reply_thread_lock``, ``_structured_logs``,
    ``_structured_logs_lock``, ``_job_snapshots``,
    ``_job_snapshots_lock``) are initialized in
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

    def get_job_snapshots(self) -> list[dict[str, Any]]:
        """Return the job-progress snapshot ring (oldest first).

        Each snapshot mirrors one ``plugin.job_progress`` notification:
        ``{jobId, percent, message}``.  The ring keeps the last 200
        updates; empty when no job has reported progress.
        """
        with self._job_snapshots_lock:
            return list(self._job_snapshots)

    def _handle_plugin_request(
        self, rid: int, method: str, params: dict[str, Any]
    ) -> None:
        """Dispatch a plugin→host request to a registered handler.

        Runs in the reader thread and never blocks on pool saturation: the
        handler runs in the bounded reverse-RPC pool, and when every slot is
        in flight the overflow request is answered immediately with a -32000
        host-busy error instead of stalling the reader (which would starve
        responses to pending forward calls).
        """
        handler = self._request_handlers.get(method)
        if handler is None:
            self._send_reply_async(
                {"jsonrpc": _JSONRPC, "id": rid,
                 "error": {"code": -32601, "message": f"method not found: {method}"}}
            )
            return
        if not self._reverse_slots.acquire(blocking=False):
            self._send_reply_async(
                {"jsonrpc": _JSONRPC, "id": rid,
                 "error": {"code": _ERR_HOST_BUSY, "message": "host busy"}}
            )
            return
        try:
            self._reverse_pool.submit(
                self._run_plugin_request, rid, handler, params
            )
        except RuntimeError:
            # Pool shut down during finalize — drop the request; the plugin is going down anyway.
            self._reverse_slots.release()

    def _send_reply_async(self, obj: dict[str, Any]) -> None:
        """Enqueue a plugin reply on the bounded reply queue.

        Runs on the reader thread: ``put_nowait`` never blocks, so a wedged
        child stdin cannot stall the reader.  When the queue saturates the
        reply is dropped with a warning (one line per drop, not per request).
        """
        self._ensure_reply_writer()
        try:
            self._reply_queue.put_nowait(obj)
        except queue.Full:
            logger.warning(
                "rpc: reply queue full, dropping reply id=%r", obj.get("id")
            )

    def _ensure_reply_writer(self) -> None:
        """Start the single reply-writer daemon on first use (idempotent)."""
        if self._reply_thread is not None and self._reply_thread.is_alive():
            return
        with self._reply_thread_lock:
            if self._reply_thread is not None and self._reply_thread.is_alive():
                return
            self._reply_thread = threading.Thread(
                target=self._reply_writer_loop, name="rpc-reply-writer", daemon=True
            )
            self._reply_thread.start()

    def _reply_writer_loop(self) -> None:
        """Drain the reply queue, writing each line directly under ``_write_lock``.

        One thread owns reply writes, so a wedged stdin (which blocks inside
        ``write`` while holding the lock) leaks at most one daemon thread
        instead of one per reply.  Lock acquisition is bounded by
        ``_write_timeout`` so a wedged forward write cannot wedge this loop.
        """
        while True:
            obj = self._reply_queue.get()
            if obj is None:
                return
            rid = obj.get("id")
            data = (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
            if not self._write_lock.acquire(timeout=self._write_timeout):
                logger.warning(
                    "rpc: reply write lock held, dropping reply id=%r", rid
                )
                continue
            try:
                proc = self._proc
                if proc is None or proc.stdin is None:
                    logger.warning(
                        "rpc: reply stdin unavailable, dropping reply id=%r", rid
                    )
                    continue
                try:
                    proc.stdin.write(data)
                    proc.stdin.flush()
                except (BrokenPipeError, OSError, ValueError) as exc:
                    logger.warning(
                        "rpc: reply write failed id=%r: %s", rid, exc
                    )
            finally:
                self._write_lock.release()

    def _stop_reply_writer(self) -> None:
        """Best-effort stop sentinel for the reply writer (daemon; may be wedged)."""
        thread = self._reply_thread
        if thread is None or not thread.is_alive():
            return
        try:
            self._reply_queue.put_nowait(None)
        except queue.Full:
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

    def _handle_plugin_job_progress(self, params: Any) -> None:
        """Push a ``plugin.job_progress`` notification into the snapshot ring.

        Runs in the reader thread.  Tolerant: non-dict params are dropped
        (the plugin sent a malformed notification).  Also appends a
        level-info structured log entry so job progress is observable in
        host logs.
        """
        if not isinstance(params, dict):
            return
        snapshot: dict[str, Any] = {
            "jobId": params.get("jobId", ""),
            "percent": params.get("percent", 0),
            "message": params.get("message", ""),
        }
        with self._job_snapshots_lock:
            self._job_snapshots.append(snapshot)
        entry: dict[str, Any] = {
            "level": "info",
            "message": f"job {snapshot['jobId']} {snapshot['percent']}%",
            "timestamp": datetime.now(UTC).isoformat(),
            "extra": {"jobId": snapshot["jobId"], "percent": snapshot["percent"]},
        }
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
        finally:
            self._reverse_slots.release()

    def _write_line(self, obj: dict[str, Any]) -> None:
        """Write one JSON-RPC line to child stdin (used for reverse-RPC responses).

        Non-raising: a broken pipe or write timeout means the child has
        exited or is not draining its stdin.  The reader loop surfaces the
        failure to in-flight forward calls separately via
        ``_fail_all_pending``.  We log a warning (with the response id and
        error) so silent data loss is debuggable, but we do not raise — the
        caller (reverse-RPC worker) has no way to recover the request.
        """
        data = (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
        rid = obj.get("id")
        try:
            self._write_bytes(data)
        except RpcProtocolError as exc:
            logger.warning(
                "rpc: _write_line dropped response id=%r: %s", rid, exc
            )
