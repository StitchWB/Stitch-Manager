"""FastAPI application factory, lifespan, and entry point.

Start the server from the CLI::

    # from python/ directory
    uvicorn stitch_backend.main:app --reload --port 25584

    # or via the installed script
    stitch-backend

The app exposes:
    GET  /health               — liveness probe
    GET  /api/cmd/             — list registered commands
    POST /api/{name}           — dispatch a command (analogue of backend invoke)
    WS   /api/events           — EventBus broadcast to frontend
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from stitch_backend import startup, workers
from stitch_backend.api.middleware import install_middleware
from stitch_backend.api.router import api_router
from stitch_backend.app_setup import install_local_middleware, register_meta_routes
from stitch_backend.config import get_settings
from stitch_backend.database import create_all_tables, dispose_engine
from stitch_backend.domains.ai_proxy.litellm_gateway import create_litellm_gateway_router
from stitch_backend.domains.plugin_distribution import distribution_proxy
from stitch_backend.logging_config import configure_logging

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup and shutdown hooks. Step order is load-bearing."""
    settings = get_settings()

    configure_logging(settings.log_level)
    await startup.log_startup_banner(settings)

    # Dev convenience; production uses Alembic.
    await create_all_tables()

    await startup.seed_permission_defaults()
    await startup.bootstrap_initial_admin(settings)
    await startup.migrate_plaintext_secrets()
    await startup.run_legacy_auto_migration()
    await startup.migrate_legacy_group_usage()
    await startup.convert_legacy_labels()
    await startup.auto_create_public_models()
    await startup.run_plugin_distribution_startup()
    await startup.seed_partner_channels()
    await startup.ensure_scheduler_tables()
    startup.import_command_modules()
    startup.register_turnstile_sidecar()
    await startup.start_service_plugins()
    await startup.ensure_local_chat_token()
    startup.prewarm_shardx()
    startup.log_discovered_providers()
    await startup.init_icloud_pool()
    await startup.restore_holone_config()
    await startup.restore_compression_config()
    await startup.start_gateway_workers()

    proxy_key_flush_task = asyncio.create_task(workers.proxy_key_flush_loop())
    group_usage_flush_task = asyncio.create_task(workers.group_usage_flush_loop())
    sandbox_idle_task = asyncio.create_task(workers.sandbox_idle_stop_loop())

    await startup.start_key_health_worker()
    await startup.emit_app_started(settings)

    yield

    logger.info("Stitch Backend shutting down …")
    await startup.stop_replenishment_service()
    await startup.stop_plugin_hosts_and_sidecars()
    await startup.stop_scheduler_worker()
    await startup.stop_gateway_workers()
    await workers.stop_task(proxy_key_flush_task)
    await workers.stop_task(group_usage_flush_task)
    await workers.stop_task(sandbox_idle_task)
    await startup.stop_key_health_worker()
    await startup.emit_app_stopping()
    await dispose_engine()


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

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_local_middleware(app, settings)
    install_middleware(app)

    app.include_router(api_router)
    # Raw distribution-server passthrough, mounted outside /api on purpose.
    app.include_router(distribution_proxy.router)
    litellm_gateway = create_litellm_gateway_router(settings)
    if litellm_gateway is not None:
        app.include_router(litellm_gateway)

    register_meta_routes(app)

    return app


app = create_app()


def run() -> None:
    """Entry point for ``stitch-backend`` console script."""
    settings = get_settings()
    uvicorn.run(
        "stitch_backend.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level=settings.log_level.lower(),
        access_log=False,
    )


if __name__ == "__main__":
    run()
