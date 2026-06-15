"""Master router — aggregates all sub-routers under ``/api``."""

from __future__ import annotations

from fastapi import APIRouter

from stitch_backend.api.cmd_dispatcher import cmd_router
from stitch_backend.api.events_ws import events_router

api_router = APIRouter(prefix="/api")

# ── Mount sub-routers ─────────────────────────────────────────────────────────
# HTTP routes
api_router.include_router(cmd_router)

# WebSocket routes (mounted at /api root since the path is already /events)
api_router.include_router(events_router)
