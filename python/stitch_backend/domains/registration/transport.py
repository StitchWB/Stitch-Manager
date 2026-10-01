"""EventBus pipeline transport — in-process PipeTransport plus the job_id registry."""

from __future__ import annotations

import logging
from typing import Any

from stitch_backend.core.event_bus import event_bus

# Logger name pinned to the pre-split service module — must not change.
logger = logging.getLogger("stitch_backend.domains.registration.service")


# PipeTransport writes JSON to sys.stdout (subprocess mode); in-process events go through the EventBus.
def _make_event_bus_transport(job_id: str, provider_name: str):
    """Create a PipeTransport subclass that routes events through EventBus
    and receives control commands from ``registration_control`` API calls.

    In-process mode:
    - emit() → EventBus (WebSocket → frontend)
    - read_command() → in-memory queue populated by push_command()
    - push_command() → called by registration_control command handler
    """
    from autoreg.pipeline.transport import PipeTransport

    class EventBusTransport(PipeTransport):
        """PipeTransport routed through EventBus, not stdin/stdout."""

        def emit(self, event: str, data: dict) -> None:
            # Skip stdout write (parent); emit to EventBus only
            event_bus.emit_sync(
                f"pipeline.{event}",
                {"jobId": job_id, "provider": provider_name, **data},
            )
            logger.debug("Emitted event: %s", event)

        def _ensure_reader(self) -> None:
            # No stdin reader — commands come via push_command()
            self._started = True

        def push_command(self, command: str, step_id=None, data=None) -> None:
            """Called by registration_control to inject a control command."""
            from autoreg.pipeline.transport import PipelineCommand
            cmd = PipelineCommand(
                command=command,
                step_id=step_id,
                data=data or {},
            )
            self._queue.append(cmd)

    transport = EventBusTransport()
    # Register transport in global registry so registration_control can push commands
    _ACTIVE_TRANSPORTS[job_id] = transport
    return transport


# Registry: job_id → EventBusTransport (so registration_control can push commands)
_ACTIVE_TRANSPORTS: dict[str, Any] = {}


def push_control_to_transport(job_id: str, command: str, step_id=None, data=None) -> bool:
    """Called by the registration_control command to forward resume/skip/abort."""
    t = _ACTIVE_TRANSPORTS.get(job_id)
    if t and hasattr(t, "push_command"):
        t.push_command(command, step_id=step_id, data=data)
        return True
    return False


def cleanup_transport(job_id: str) -> None:
    """Remove transport from registry when job completes."""
    _ACTIVE_TRANSPORTS.pop(job_id, None)
