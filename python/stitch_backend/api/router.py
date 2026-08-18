"""Master router — aggregates all sub-routers under ``/api``."""

from __future__ import annotations

from fastapi import APIRouter

from stitch_backend.api.cmd_dispatcher import cmd_router
from stitch_backend.api.events_ws import events_router
from stitch_backend.domains.ai_proxy.chat_router import chat_router
from stitch_backend.domains.ai_proxy.compression.api import router as compression_router
from stitch_backend.domains.ai_proxy.holone_api import router as holone_router
from stitch_backend.domains.ai_proxy.metrics_api import router as metrics_router
from stitch_backend.domains.api_keys.router import router as api_keys_router
from stitch_backend.domains.auth.router import router as auth_router
from stitch_backend.domains.plugin_distribution.admin_router import router as dist_admin_router
from stitch_backend.domains.profiles.router import profiles_router

api_router = APIRouter(prefix="/api")

# ── Mount sub-routers ─────────────────────────────────────────────────────────
# HTTP routes (RPC-style command dispatch)
api_router.include_router(cmd_router)

# REST endpoints (domain routers)
api_router.include_router(auth_router)
api_router.include_router(profiles_router)
api_router.include_router(api_keys_router)
api_router.include_router(metrics_router)
api_router.include_router(holone_router)
api_router.include_router(compression_router)
api_router.include_router(dist_admin_router)

# WebSocket routes (mounted at /api root since the path is already /events)
api_router.include_router(events_router)

# OpenAI-compatible chat endpoint used by Python-backed providers.
api_router.include_router(chat_router, prefix="")
