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
from fastapi.staticfiles import StaticFiles

from stitch_backend.api.middleware import install_middleware
from stitch_backend.api.router import api_router
from stitch_backend.config import get_settings, REPO_ROOT
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

    # Create scheduler tables (raw SQL, not ORM models)
    from stitch_backend.database import get_session_factory
    from stitch_backend.domains.scheduler.service import ensure_tables as _sched_tables
    factory = get_session_factory()
    async with factory() as _db:
        await _sched_tables(_db)

    # Import command modules so @register_command decorators fire
    import stitch_backend.domains.accounts.commands   # noqa: F401
    import stitch_backend.domains.settings.commands   # noqa: F401
    import stitch_backend.domains.utility.commands    # noqa: F401
    import stitch_backend.domains.registration.commands  # noqa: F401
    import stitch_backend.domains.email.commands          # noqa: F401
    import stitch_backend.domains.oauth.commands           # noqa: F401
    import stitch_backend.domains.activation.commands      # noqa: F401
    import stitch_backend.domains.patcher.commands         # noqa: F401
    import stitch_backend.domains.browser.commands         # noqa: F401
    import stitch_backend.domains.proxy_library.commands  # noqa: F401
    import stitch_backend.domains.scenarios.commands       # noqa: F401
    import stitch_backend.domains.scheduler.commands       # noqa: F401
    import stitch_backend.domains.proxy_mgmt.commands       # noqa: F401
    import stitch_backend.domains.google_sheets.commands      # noqa: F401
    import stitch_backend.domains.replenishment.commands       # noqa: F401
    import stitch_backend.domains.profiles.commands              # noqa: F401
    import stitch_backend.domains.api_keys.commands               # noqa: F401
    import stitch_backend.domains.email_counter.commands          # noqa: F401
    import stitch_backend.domains.composed_flows.commands         # noqa: F401
    import stitch_backend.domains.prompts.commands                # noqa: F401
    import stitch_backend.domains.freemodel_bridge.commands       # noqa: F401
    import stitch_backend.domains.email_inbox.commands           # noqa: F401
    import stitch_backend.domains.router.commands                # noqa: F401
    import stitch_backend.domains.background_manager.commands    # noqa: F401
    import stitch_backend.domains.cards.commands                 # noqa: F401
    import stitch_backend.domains.kiro_patch.commands            # noqa: F401
    import stitch_backend.domains.account_status.commands        # noqa: F401
    import stitch_backend.domains.ai_proxy.commands             # noqa: F401
    import stitch_backend.domains.python_jobs.commands           # noqa: F401
    import stitch_backend.domains.mcp_bridge.commands            # noqa: F401
    import stitch_backend.domains.utility.file_dialogs           # noqa: F401
    import stitch_backend.domains.utility.stubs                  # noqa: F401

    # Import EventBus listeners (side-effect: register @event_bus.on handlers)
    import stitch_backend.domains.proxy_mgmt.event_listeners  # noqa: F401

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

    # Stop replenishment service if running
    from stitch_backend.domains.replenishment.service import get_replenishment_service as _get_replen
    await _get_replen().stop()

    # Stop OmniRoute sidecar if running
    from stitch_backend.domains.proxy_mgmt.omniroute import stop_omniroute as _stop_or
    try:
        await _stop_or()
    except Exception:
        logger.debug("OmniRoute stop during shutdown: not running or already stopped")

    # Stop scheduled worker
    from stitch_backend.domains.scheduler.worker import get_worker
    await get_worker().stop()

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
    # Static serving is optional: only when Vite build output (dist/) exists.
    # If dist/ is absent the server runs in API-only mode (useful during dev).
    dist_dir = REPO_ROOT / "dist"
    dist_index = dist_dir / "index.html"

    # Health must be registered BEFORE any Mount("/") so it is not shadowed
    # by the static file catch-all.
    @app.get("/health", tags=["Meta"])
    async def health() -> dict:
        return {"status": "ok"}

    if dist_index.exists():
        logger.info("Static files found at %s — mounting SPA at /", dist_dir)
        # Mount AFTER /health so the health probe is not shadowed.
        # StaticFiles(html=True) serves index.html for any unmatched path,
        # enabling client-side SPA routing.
        app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="static")
    else:
        logger.info("No dist/index.html — running in API-only mode")

        @app.get("/", tags=["Meta"])
        async def root() -> dict:
            return {
                "name": "Stitch Manager v2",
                "version": "0.2.0",
                "docs": "/docs",
                "health": "/health",
            }

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
