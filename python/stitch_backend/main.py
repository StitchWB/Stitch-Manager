"""FastAPI application factory, lifespan, and entry point.

Start the server from the CLI::

    # from python/ directory
    uvicorn stitch_backend.main:app --reload --port 25584

    # or via the installed script
    stitch-backend

The app exposes:
    GET  /health               — liveness probe
    GET  /api/cmd/             — list registered commands
    POST /api/{name}           — dispatch a command (analogue of Tauri invoke)
    WS   /api/events           — EventBus broadcast to frontend
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from stitch_backend.api.middleware import install_middleware
from stitch_backend.api.router import api_router
from stitch_backend.config import get_settings
from stitch_backend.database import create_all_tables, dispose_engine

logger = logging.getLogger(__name__)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup and shutdown hooks."""
    settings = get_settings()

    # Configure root logger
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
        datefmt="%H:%M:%S",
    )

    logger.info("Stitch Backend starting — port=%d  db=%s", settings.port, settings.database_url)

    # Ensure tables exist (dev convenience; use Alembic in production)
    await create_all_tables()

    # Import command modules so @register_command decorators fire
    import stitch_backend.domains.accounts.commands   # noqa: F401
    import stitch_backend.domains.settings.commands   # noqa: F401
    import stitch_backend.domains.utility.commands    # noqa: F401

    from stitch_backend.core.command_registry import list_commands, scan_providers
    commands = list_commands()
    logger.info("Registered %d command(s): %s", len(commands), commands)

    # Auto-discover provider plugins
    providers = scan_providers()
    if providers:
        logger.info("Discovered %d provider(s): %s", len(providers), list(providers.keys()))

    # Emit a startup event for any domain listeners
    from stitch_backend.core.event_bus import event_bus
    await event_bus.emit("app.started", {"port": settings.port})

    yield

    # Shutdown
    logger.info("Stitch Backend shutting down …")
    await event_bus.emit("app.stopping", {})
    await dispose_engine()


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title="Stitch Manager v2",
        version="0.2.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # ── CORS ──────────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Middleware (timing, error mapping) ─────────────────────────────────────
    install_middleware(app)

    # ── Routes ────────────────────────────────────────────────────────────────
    app.include_router(api_router)

    # ── Root / health ─────────────────────────────────────────────────────────

    @app.get("/", tags=["Meta"])
    async def root() -> dict:
        return {
            "name": "Stitch Manager v2",
            "version": "0.2.0",
            "docs": "/docs",
            "health": "/health",
        }

    @app.get("/health", tags=["Meta"])
    async def health() -> dict:
        return {"status": "ok"}

    return app


# ── Module-level app instance (for uvicorn --reload) ──────────────────────────

app = create_app()


# ── CLI entry point ───────────────────────────────────────────────────────────

def run() -> None:
    """Entry point for ``stitch-backend`` console script."""
    settings = get_settings()
    uvicorn.run(
        "stitch_backend.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    run()
