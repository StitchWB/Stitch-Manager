"""Child stderr pumping into the host's log ring buffer."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from stitch_backend.domains.plugin_runtime.host import ServicePluginHost


def stderr_reader(host: ServicePluginHost) -> None:
    """Read child stderr line-by-line into the ring buffer."""
    proc = host.rpc._proc
    if proc is None or proc.stderr is None:
        return
    stream = proc.stderr
    try:
        for raw in iter(stream.readline, b""):
            host._log_buffer.append(
                raw.decode("utf-8", errors="replace").rstrip("\r\n")
            )
    except Exception:  # noqa: BLE001 — pipe closed / process dead
        pass
