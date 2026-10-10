"""Plugin stderr ingestion into the activity-log store (``plugin:<id>`` sources)."""

from __future__ import annotations

from stitch_backend.core.event_bus import Event, event_bus
from stitch_backend.database import run_in_session
from stitch_backend.domains.logging.service import LoggingService


@event_bus.on("plugin.stderr")
async def _on_plugin_stderr(event: Event) -> None:
    """Persist one plugin stderr line as an activity-log entry."""
    data = event.data
    plugin_id = data.get("plugin_id")
    message = data.get("message")
    if not isinstance(plugin_id, str) or not plugin_id or not isinstance(message, str):
        return
    level = data.get("level")
    if not isinstance(level, str):
        level = "info"
    await run_in_session(
        lambda s: LoggingService(s).add_log(
            level, f"plugin:{plugin_id}", message, channel="backend"
        )
    )
