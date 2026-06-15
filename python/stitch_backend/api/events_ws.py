"""WebSocket endpoint ``/api/events`` — bridges EventBus → frontend.

Every connected client receives every event emitted via :func:`event_bus.emit`.
Messages are JSON objects::

    {
        "event": "account.token_refreshed",
        "data":  {"account_id": "abc123", ...},
        "timestamp": "2026-06-15T12:34:56+00:00"
    }

Clients only *read* — there is no client → server protocol (yet).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from stitch_backend.core.event_bus import event_bus

logger = logging.getLogger(__name__)

events_router = APIRouter(tags=["Events"])

# Maximum messages buffered per client before the client is dropped
_WS_QUEUE_SIZE = 256


@events_router.websocket("/events")
async def events_websocket(ws: WebSocket) -> None:
    """Long-lived WebSocket connection; broadcasts EventBus events."""
    await ws.accept()
    logger.debug("WS client connected (total=%d)", event_bus.ws_client_count + 1)

    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=_WS_QUEUE_SIZE)
    event_bus.register_ws_client(queue)

    try:
        while True:
            # Wait for a message from the EventBus
            payload = await queue.get()
            try:
                await ws.send_json(payload)
            except Exception:
                # Client went away mid-send
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("WS connection closed unexpectedly", exc_info=True)
    finally:
        event_bus.unregister_ws_client(queue)
        logger.debug("WS client disconnected (total=%d)", event_bus.ws_client_count)
