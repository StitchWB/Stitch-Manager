"""Per-host call metrics: recording and snapshot shaping."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from stitch_backend.domains.plugin_runtime.host import ServicePluginHost


def record_call(
    host: ServicePluginHost,
    cmd_name: str,
    elapsed_ms: float,
    *,
    error: str | None = None,
) -> None:
    """Record one call outcome under the metrics lock (thread-safe).

    ``error`` is the human-readable failure reason (command name is
    embedded by the caller via ``cmd_name``).  Per-command counters
    are kept under ``by_command``; the global ``last_error`` carries
    the most recent failure string (None when the last call succeeded).
    """
    with host._metrics_lock:
        host._metrics_calls += 1
        host._metrics_latency_ms += elapsed_ms
        slot = host._metrics_by_command.setdefault(
            cmd_name, {"calls": 0, "errors": 0}
        )
        slot["calls"] += 1
        if error is not None:
            host._metrics_errors += 1
            slot["errors"] += 1
            host._metrics_last_error = f"{cmd_name}: {error}"
        else:
            host._metrics_last_error = None


def metrics_snapshot(host: ServicePluginHost) -> dict[str, Any]:
    """Return host-served call metrics (no RPC roundtrip).

    Shape (fixed contract — served by ``plugin.{id}.metrics`` and
    the ``service_plugin_metrics`` admin command):

        {
          "calls": int,
          "errors": int,
          "avg_latency_ms": float,
          "last_error": str | None,
          "by_command": {name: {"calls": int, "errors": int}},
          "peak_memory_mb": float | None,
          "total_cpu_s": float | None,
        }

    ``avg_latency_ms`` is 0.0 when no calls have been made.
    ``peak_memory_mb`` / ``total_cpu_s`` are None until the first
    child death is observed (best-effort resource accounting).
    """
    with host._metrics_lock:
        calls = host._metrics_calls
        errors = host._metrics_errors
        latency = host._metrics_latency_ms
        last_error = host._metrics_last_error
        by_command = {
            name: {"calls": s["calls"], "errors": s["errors"]}
            for name, s in host._metrics_by_command.items()
        }
    avg = (latency / calls) if calls else 0.0
    return {
        "calls": calls,
        "errors": errors,
        "avg_latency_ms": avg,
        "last_error": last_error,
        "by_command": by_command,
        "peak_memory_mb": host._peak_memory_mb,
        "total_cpu_s": host._total_cpu_s,
    }
