"""FastAPI application factory, lifespan, and entry point.

Start the server::

    # from python/ directory
    uvicorn stitch_server.main:app --reload --port 8900

The server is deliberately thin — a VPS-deployable FastAPI app.
Tokens are NOT tied to Telegram ids (privacy + replaceable activation
channel). The signing key is OFFLINE; packages and manifest signatures
arrive pre-signed via admin publish.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from stitch_server import monitoring
from stitch_server.config import get_settings
from stitch_server.db import create_all_tables, dispose_engine
from stitch_server.routers import (
    activate,
    admin,
    admin_summary,
    drift,
    heartbeat,
    manifest,
    plugins,
    reports,
    selectors,
)
from stitch_server.routers import (
    monitoring as monitoring_router,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup and shutdown hooks."""
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    logger.info("Stitch plugin server starting — port=%d  db=%s", settings.port, settings.database_url)
    await create_all_tables()
    probe_task = asyncio.create_task(monitoring.probe_loop())
    _app.state.monitoring_task = probe_task
    yield
    probe_task.cancel()
    try:
        await probe_task
    except asyncio.CancelledError:
        pass
    logger.info("Stitch plugin server shutting down")
    await dispose_engine()


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    app = FastAPI(
        title="Stitch Plugin Server",
        version="0.1.0",
        docs_url="/docs",
        redoc_url=None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(activate.router, tags=["Activation"])
    app.include_router(manifest.router, tags=["Manifest"])
    app.include_router(plugins.router, tags=["Plugins"])
    app.include_router(selectors.router, tags=["Selectors"])
    app.include_router(reports.router, tags=["Reports"])
    app.include_router(heartbeat.router, tags=["Heartbeat"])
    app.include_router(admin.router, tags=["Admin"])
    app.include_router(admin_summary.router, tags=["Admin"])
    app.include_router(drift.router, tags=["Admin"])
    app.include_router(monitoring_router.router, tags=["Admin"])

    @app.get("/health", tags=["Meta"])
    async def health() -> dict:
        return {"status": "ok"}

    @app.get("/", tags=["Meta"])
    async def root() -> dict:
        return {
            "name": "Stitch Plugin Server",
            "version": "0.1.0",
            "docs": "/docs",
            "health": "/health",
        }

    return app


app = create_app()
