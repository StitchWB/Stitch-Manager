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

import asyncio
import logging
import sys
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
from stitch_backend.domains.ai_proxy.litellm_gateway import create_litellm_gateway_router

logger = logging.getLogger(__name__)


def _configure_logging(level: str) -> None:
    """Configure logging to write INFO to stdout, ERROR/WARNING to stderr."""
    # Create handlers
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setLevel(logging.DEBUG)
    stdout_handler.addFilter(lambda record: record.levelno < logging.WARNING)
    
    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setLevel(logging.WARNING)
    
    # Create formatter
    formatter = logging.Formatter(
        "%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
        datefmt="%H:%M:%S",
    )
    stdout_handler.setFormatter(formatter)
    stderr_handler.setFormatter(formatter)
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(level)
    root_logger.addHandler(stdout_handler)
    root_logger.addHandler(stderr_handler)
    
    # Reduce noise from command_registry warnings (expected in dev mode with --reload)
    logging.getLogger("stitch_backend.core.command_registry").setLevel(logging.ERROR)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup and shutdown hooks."""
    settings = get_settings()

    # Configure logging: INFO to stdout, ERROR/WARNING to stderr
    _configure_logging(settings.log_level)

    try:
        from stitch_backend.version import __version__
        logger.info("Stitch Backend v%s starting — port=%d  db=%s", __version__, settings.port, settings.database_url)
    except ImportError:
        logger.info("Stitch Backend (dev) starting — port=%d  db=%s", settings.port, settings.database_url)

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
    import stitch_backend.domains.proxy_mgmt.holone_commands  # noqa: F401
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
    import stitch_backend.domains.ai_proxy.zai_token_commands   # noqa: F401
    import stitch_backend.domains.opencode_config.commands       # noqa: F401
    import stitch_backend.domains.python_jobs.commands           # noqa: F401
    import stitch_backend.domains.mcp_bridge.commands            # noqa: F401
    import stitch_backend.domains.logging.commands               # noqa: F401
    import stitch_backend.domains.aws_accounts.commands          # noqa: F401
    import stitch_backend.domains.quota.commands                 # noqa: F401
    import stitch_backend.domains.telemetry.commands             # noqa: F401
    import stitch_backend.domains.totp.commands                  # noqa: F401
    import stitch_backend.domains.utility.file_dialogs           # noqa: F401
    import stitch_backend.domains.utility.stubs                  # noqa: F401
    import stitch_backend.domains.icloud_email_pool.commands     # noqa: F401

    # Import EventBus listeners (side-effect: register @event_bus.on handlers)
    import stitch_backend.domains.proxy_mgmt.event_listeners  # noqa: F401

    from stitch_backend.core.command_registry import list_commands, scan_providers
    commands = list_commands()
    logger.info("Registered %d command(s)", len(commands))
    logger.debug("Registered commands: %s", commands)

    # Auto-discover provider plugins
    providers = scan_providers()
    if providers:
        logger.info("Discovered %d provider(s): %s", len(providers), list(providers.keys()))

    # iCloud pool — register bridge + auto-configure from saved settings
    try:
        from stitch_backend.domains.icloud_email_pool.service import get_icloud_pool_service
        from stitch_backend.database import get_session_factory as _gsf
        icloud_svc = get_icloud_pool_service()
        icloud_svc.register_bridge()

        # Try to restore credentials from settings so the session can be
        # re-authenticated automatically on next fill or claim.
        async def _load_icloud_settings():
            factory = _gsf()
            async with factory() as _db:
                from stitch_backend.domains.settings.service import SettingsService
                _settings = await SettingsService(_db).get_all()
            apple_id = _settings.get("icloudAppleId", "")
            app_pw   = _settings.get("icloudAppPassword", "")
            enabled  = _settings.get("icloudEnabled", False)
            if enabled and apple_id and app_pw and app_pw != "********":
                icloud_svc.configure(apple_id=apple_id, app_password=app_pw)
                logger.info("iCloud pool service pre-configured for %s", apple_id)

        await _load_icloud_settings()
    except Exception as _exc:
        logger.warning("iCloud pool service init skipped: %s", _exc)

    # Emit a startup event for any domain listeners
    from stitch_backend.core.event_bus import event_bus
    event_bus.set_loop(asyncio.get_event_loop())
    await event_bus.emit("app.started", {"port": settings.port})

    yield

    # Shutdown
    logger.info("Stitch Backend shutting down …")

    # Stop replenishment service if running
    from stitch_backend.domains.replenishment.service import get_replenishment_service as _get_replen
    await _get_replen().stop()

    # ponytail: native gateway runs with Stitch process; no sidecar shutdown needed
    # Legacy OmniRoute/HoloNe sidecar shutdown removed

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
    litellm_gateway = create_litellm_gateway_router(settings)
    if litellm_gateway is not None:
        app.include_router(litellm_gateway)

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
