"""Event payload contracts — Pydantic models for cross-boundary events.

These schemas serve as the single source of truth for event payloads
emitted by the Python backend and consumed by the frontend over WebSocket.

Usage::

    from stitch_backend.core.event_schemas import ObsEventPayload

    payload = ObsEventPayload(
        source="python",
        subsystem="registration",
        level="info",
        message="Starting registration...",
        jobId="abc123",
        provider="fireworks",
    )
    event_bus.emit_sync("obs:event", payload.model_dump(exclude_none=True))

If a required field is missing, Pydantic raises ``ValidationError`` at
construction time — catching bugs before they reach the frontend.
"""

from __future__ import annotations

from pydantic import BaseModel


class ObsEventPayload(BaseModel):
    """Schema for ``obs:event`` payloads consumed by the frontend.

    The frontend's ``useEventListeners.ts`` filters events by
    ``source === 'python'`` or ``subsystem === 'jobs'``.  Both fields
    are therefore **required** — omitting them causes the event to be
    silently dropped.
    """

    source: str
    """Origin of the event: 'python', 'frontend', etc."""

    subsystem: str
    """Domain subsystem: 'registration', 'jobs', 'proxy', etc."""

    level: str
    """Log level: 'info', 'error', 'warn', 'debug', 'success'."""

    message: str
    """Human-readable log message."""

    # Optional enrichment fields
    jobId: str | None = None
    provider: str | None = None


class LogEntryPayload(BaseModel):
    """Schema for ``logs:new`` payloads consumed by the global log store.

    Must match the TypeScript ``LogEntry`` interface in
    ``src/stores/logs.ts``.
    """

    id: str
    """Unique log entry ID."""

    timestamp: str
    """ISO-8601 UTC timestamp."""

    level: str
    """Log level: 'debug', 'info', 'success', 'warn', 'error'."""

    source: str
    """Log source: 'registration', 'accounts', 'server', etc."""

    message: str
    """Human-readable log message."""

    channel: str = "app"
    """Log channel: 'app', 'backend', 'frontend', etc."""
