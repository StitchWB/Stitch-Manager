"""In-process async EventBus with WebSocket broadcast support.

Domains communicate exclusively through events — never by importing each other
directly.  Every emitted event is:
  1. Dispatched to all registered in-process async handlers (fire-and-forget tasks).
  2. Broadcast to every connected WebSocket client (frontend).

Usage
-----
    from stitch_backend.core.event_bus import event_bus

    # Subscribe
    @event_bus.on("account.token_refreshed")
    async def handle_token_refresh(event: Event) -> None:
        ...

    # Emit
    await event_bus.emit("account.token_refreshed", {"account_id": "abc"})
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)

# Type alias for an async handler
EventHandler = Callable[["Event"], Coroutine[Any, Any, None]]


# ── Event dataclass ───────────────────────────────────────────────────────────

@dataclass
class Event:
    """Immutable-ish event envelope."""

    name: str
    data: dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_ws_payload(self) -> dict[str, Any]:
        """Serialize for WebSocket broadcast."""
        return {
            "event": self.name,
            "data": self.data,
            "timestamp": self.timestamp.isoformat(),
        }


# ── EventBus ──────────────────────────────────────────────────────────────────

class EventBus:
    """Async event bus with per-event handler lists and WS fan-out."""

    def __init__(self) -> None:
        self._handlers: dict[str, list[EventHandler]] = {}
        self._ws_clients: list[asyncio.Queue[dict[str, Any]]] = []
        self._loop: asyncio.AbstractEventLoop | None = None

    # ── Subscribe ─────────────────────────────────────────────────────────────

    def on(self, event_name: str) -> Callable[[EventHandler], EventHandler]:
        """Decorator: register *handler* for *event_name*.

        Can be stacked for the same handler to listen to multiple events.
        """

        def decorator(handler: EventHandler) -> EventHandler:
            bucket = self._handlers.setdefault(event_name, [])
            if handler not in bucket:
                bucket.append(handler)
            return handler

        return decorator

    def off(self, event_name: str, handler: EventHandler) -> None:
        """Unsubscribe *handler* from *event_name*."""
        bucket = self._handlers.get(event_name, [])
        try:
            bucket.remove(handler)
        except ValueError:
            pass

    # ── Emit ──────────────────────────────────────────────────────────────────

    async def emit(self, event_name: str, data: dict[str, Any] | None = None) -> None:
        """Fire an event: run all handlers concurrently + broadcast to WS."""
        event = Event(name=event_name, data=data or {})
        logger.debug("EventBus emit: %s", event_name)

        # 1) In-process handlers (fire-and-forget)
        for handler in self._handlers.get(event_name, []):
            asyncio.create_task(self._safe_call(handler, event))

        # 2) WebSocket broadcast (non-blocking put)
        ws_payload = event.to_ws_payload()
        stale: list[asyncio.Queue[dict[str, Any]]] = []
        for queue in self._ws_clients:
            try:
                queue.put_nowait(ws_payload)
            except asyncio.QueueFull:
                # Client is too slow — drop it
                stale.append(queue)
        for q in stale:
            self.unregister_ws_client(q)

    # ── WebSocket client management ───────────────────────────────────────────

    def register_ws_client(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        """Add a per-connection queue; the WS endpoint reads from it."""
        if queue not in self._ws_clients:
            self._ws_clients.append(queue)

    def unregister_ws_client(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        try:
            self._ws_clients.remove(queue)
        except ValueError:
            pass

    @property
    def ws_client_count(self) -> int:
        return len(self._ws_clients)

    # ── Sync emit (for threads) ─────────────────────────────────────────────

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Store the running event loop so emit_sync can schedule on it."""
        self._loop = loop

    def emit_sync(self, event_name: str, data: dict[str, Any] | None = None) -> None:
        """Thread-safe emit — schedules ``emit()`` on the stored event loop.

        Safe to call from ``asyncio.to_thread()`` or any background thread.
        """
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(self.emit(event_name, data or {}), loop)

    # ── Internal ──────────────────────────────────────────────────────────────

    @staticmethod
    async def _safe_call(handler: EventHandler, event: Event) -> None:
        try:
            await handler(event)
        except Exception:
            logger.exception("EventBus handler error for event=%s", event.name)


# ── Global singleton ──────────────────────────────────────────────────────────

event_bus = EventBus()
