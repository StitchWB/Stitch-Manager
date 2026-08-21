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
import sys
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from stitch_backend.api.middleware import install_middleware
from stitch_backend.api.router import api_router
from stitch_backend.config import REPO_ROOT, get_settings
from stitch_backend.database import create_all_tables, dispose_engine
from stitch_backend.domains.ai_proxy.litellm_gateway import create_litellm_gateway_router

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

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

    # Third-party HTTP clients are noisy at INFO (KeyHealth worker probes ~35 keys
    # every 5 minutes → one httpx INFO line per request). Warnings/errors only.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    # Suppress uvicorn's access log — the custom timing_middleware is the
    # replacement access log and produces richer, deduplicated output.
    # This MUST happen here (not in run()) because dev mode launches uvicorn
    # via CLI which never calls run() — lifespan calls _configure_logging.
    logging.getLogger("uvicorn.access").disabled = True


# ── Lifespan ──────────────────────────────────────────────────────────────────

async def _run_legacy_auto_migration() -> None:
    """L2 final wave: drain ``ai_proxy_accounts`` → ai_gateway credentials.

    Delegates to :func:`legacy_accounts_api.run_final_conversion` which:
    - Checks if the legacy table exists (PRAGMA) and has rows.
    - Converts each row via ``create_account`` (dedupes by fingerprint).
    - On success: DELETE the rows (table stays empty/inert, never dropped).
    - On failure: warn + keep rows + set ``conversion_failed`` flag.

    Idempotent — safe to call on every boot. On any exception → warning +
    continue (boot must never fail).
    """
    from stitch_backend.database import get_session_factory
    from stitch_backend.domains.ai_proxy.legacy_accounts_api import (
        run_final_conversion,
    )

    factory = get_session_factory()
    async with factory() as _db:
        counts = await run_final_conversion(_db)
        if counts["legacy_rows"] > 0:
            await _db.commit()


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

    # Seed default role-permission matrix (idempotent — also inserts
    # missing keys after upgrades so new keys appear automatically).
    try:
        from stitch_backend.database import get_session_factory
        from stitch_backend.domains.auth.permissions import seed_defaults

        factory = get_session_factory()
        async with factory() as _db:
            await seed_defaults(_db)
            await _db.commit()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Permission seed skipped: %s", _exc)

    # Optional app-level auth: when enabled and no users exist, bootstrap
    # the initial admin from STITCH_ADMIN_PASSWORD (never logged).  Safe
    # no-op when auth is off (desktop single-user mode).
    if settings.auth_enabled and settings.admin_password:
        try:
            from stitch_backend.database import get_session_factory
            from stitch_backend.domains.auth.service import bootstrap_admin

            factory = get_session_factory()
            async with factory() as _db:
                created = await bootstrap_admin(_db, settings.admin_password)
                if created is not None:
                    await _db.commit()
                    logger.info(
                        "Auth bootstrap: created initial admin user %r",
                        created.username,
                    )
        except Exception as _exc:  # noqa: BLE001
            logger.warning("Auth bootstrap skipped: %s", _exc)

    # Encrypt-at-rest migration: re-encrypt any plaintext secrets left over
    # from before EncryptedText was applied (idempotent — skips encrypted rows).
    try:
        from stitch_backend.security.fernet_at_rest import migrate_plaintext_to_encrypted
        await migrate_plaintext_to_encrypted()
    except Exception as _exc:
        logger.error("Encrypted-at-rest migration failed: %s", _exc)

    # L2 final wave: drain ai_proxy_accounts → ai_gateway credentials.
    # Idempotent — converts any remaining legacy rows via create_account
    # (dedupes by fingerprint) and DELETEs them. Table stays inert, never
    # dropped. On failure → warn + keep rows + conversion_failed flag.
    try:
        await _run_legacy_auto_migration()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Legacy auto-migration skipped: %s", _exc)

    # P0.2: convert old JSON-in-label rows to the new split (label=name,
    # legacy_metadata=extras).  Idempotent — rows already in the new format
    # are skipped.  Runs after the legacy auto-migration so newly migrated
    # rows (which use the old JSON-in-label format) are converted too.
    try:
        from stitch_backend.database import get_session_factory
        from stitch_backend.domains.ai_proxy.legacy_accounts_api import convert_legacy_labels

        factory = get_session_factory()
        async with factory() as _db:
            converted = await convert_legacy_labels(_db)
            if converted:
                await _db.commit()
                logger.info("Legacy label conversion: %d rows migrated", converted)
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Legacy label conversion skipped: %s", _exc)

    # L2 legacy swap: auto-create PublicModels from legacy
    # BackgroundManagerConfig providers when none exist. When this succeeds,
    # the LiteLLM-config fallback in litellm_executor.models() is removed.
    # On failure, the fallback is kept (try/except inside the function).
    try:
        from stitch_backend.domains.ai_proxy.litellm_executor import (
            auto_create_public_models_from_config,
        )
        await auto_create_public_models_from_config()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("PublicModel auto-create skipped: %s", _exc)

    # Plugin distribution: activate → heartbeat → sync (never blocks startup)
    try:
        from stitch_backend.domains.plugin_distribution import run_startup_sequence
        await run_startup_sequence()
    except Exception as _exc:
        logger.warning("Plugin distribution startup skipped: %s", _exc)

    # Create scheduler tables (raw SQL, not ORM models)
    from stitch_backend.database import get_session_factory
    from stitch_backend.domains.scheduler.service import ensure_tables as _sched_tables
    factory = get_session_factory()
    async with factory() as _db:
        await _sched_tables(_db)

    # Import command modules so @register_command decorators fire
    import stitch_backend.domains.account_status.commands  # noqa: F401
    import stitch_backend.domains.accounts.commands  # noqa: F401
    import stitch_backend.domains.activation.commands  # noqa: F401
    import stitch_backend.domains.ai_gateway.commands  # noqa: F401
    import stitch_backend.domains.ai_gateway.migration_commands  # noqa: F401
    import stitch_backend.domains.ai_proxy.commands  # noqa: F401
    import stitch_backend.domains.ai_proxy.zai_token_commands  # noqa: F401
    import stitch_backend.domains.api_keys.commands  # noqa: F401
    import stitch_backend.domains.auth.telegram_commands  # noqa: F401
    import stitch_backend.domains.aws_accounts.commands  # noqa: F401
    import stitch_backend.domains.background_manager.commands  # noqa: F401
    import stitch_backend.domains.browser.commands  # noqa: F401
    import stitch_backend.domains.cards.commands  # noqa: F401
    import stitch_backend.domains.community.commands  # noqa: F401
    import stitch_backend.domains.composed_flows.commands  # noqa: F401
    import stitch_backend.domains.email.commands  # noqa: F401
    import stitch_backend.domains.email_counter.commands  # noqa: F401
    import stitch_backend.domains.email_inbox.commands  # noqa: F401
    import stitch_backend.domains.freemodel_bridge.commands  # noqa: F401
    import stitch_backend.domains.google_sheets.commands  # noqa: F401
    import stitch_backend.domains.google_sheets.oauth_commands  # noqa: F401
    import stitch_backend.domains.groups.commands  # noqa: F401
    import stitch_backend.domains.icloud_email_pool.commands  # noqa: F401
    import stitch_backend.domains.key_health.commands  # noqa: F401
    import stitch_backend.domains.keys.commands  # noqa: F401
    import stitch_backend.domains.kiro_patch.commands  # noqa: F401
    import stitch_backend.domains.notebooklm.commands  # noqa: F401
    import stitch_backend.domains.kiro_proxy.commands  # noqa: F401
    import stitch_backend.domains.logging.commands  # noqa: F401
    import stitch_backend.domains.mcp_bridge.commands  # noqa: F401
    import stitch_backend.domains.oauth.commands  # noqa: F401
    import stitch_backend.domains.opencode_config.commands  # noqa: F401
    import stitch_backend.domains.patcher.commands  # noqa: F401
    import stitch_backend.domains.plugin_distribution.commands  # noqa: F401
    import stitch_backend.domains.plugin_distribution.community_commands  # noqa: F401
    import stitch_backend.domains.plugin_distribution.grant_commands  # noqa: F401
    import stitch_backend.domains.plugin_distribution.marketplace_commands  # noqa: F401
    import stitch_backend.domains.plugin_distribution.override_commands  # noqa: F401
    import stitch_backend.domains.profiles.commands  # noqa: F401
    import stitch_backend.domains.prompts.commands  # noqa: F401
    import stitch_backend.domains.proxy_library.commands  # noqa: F401
    import stitch_backend.domains.python_jobs.commands  # noqa: F401
    import stitch_backend.domains.registration.commands  # noqa: F401
    import stitch_backend.domains.replenishment.commands  # noqa: F401
    import stitch_backend.domains.router.commands  # noqa: F401
    import stitch_backend.domains.scenarios.commands  # noqa: F401
    import stitch_backend.domains.scheduler.commands  # noqa: F401
    import stitch_backend.domains.settings.commands  # noqa: F401
    import stitch_backend.domains.totp.commands  # noqa: F401
    import stitch_backend.domains.turnstile_solver.commands  # noqa: F401
    import stitch_backend.domains.utility.commands  # noqa: F401
    import stitch_backend.domains.utility.file_dialogs  # noqa: F401
    import stitch_backend.domains.utility.stubs  # noqa: F401
    from stitch_backend.core.command_registry import get_command_meta, list_commands, scan_providers
    commands = list_commands()
    readonly_count = sum(1 for c in commands if get_command_meta(c).readonly)
    logger.info("Registered %d command(s), %d readonly", len(commands), readonly_count)
    logger.debug("Registered commands: %s", commands)

    # Register sidecar subprocess specs with the supervisor so stop_all() on
    # shutdown knows about every sidecar (freemodel bridge, turnstile solver).
    try:
        from stitch_backend.domains.freemodel_bridge.service import (
            register_sidecar as _register_freemodel,
        )
        from stitch_backend.domains.turnstile_solver.service import (
            register_sidecar as _register_turnstile,
        )

        _register_freemodel()
        _register_turnstile()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Sidecar registration skipped: %s", _exc)

    # Load-or-create the per-install local chat token so the chat endpoint can
    # authenticate with it (replaces the shared static bearer).
    try:
        from stitch_backend.domains.ai_proxy.chat_router import (
            ensure_local_chat_token as _ensure_chat_token,
        )

        await _ensure_chat_token()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Local chat token init skipped: %s", _exc)

    # Prewarm the heavy optional shardx import (pulls patchright/playwright,
    # ~1 s) in a daemon thread so the first get_browser_engines probe and the
    # first ShardBrowser launch don't stall the UI.
    import threading as _threading

    def _prewarm_shardx() -> None:
        try:
            import shardx  # noqa: F401
        except Exception:  # noqa: BLE001 — optional dependency
            pass

    _threading.Thread(target=_prewarm_shardx, daemon=True, name="shardx-prewarm").start()

    # Auto-discover provider plugins
    providers = scan_providers()
    if providers:
        logger.info("Discovered %d provider(s): %s", len(providers), list(providers.keys()))

    # iCloud pool — register bridge + auto-configure from saved settings
    try:
        from stitch_backend.database import get_session_factory as _gsf
        from stitch_backend.domains.icloud_email_pool.service import get_icloud_pool_service
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

    # Start AI Gateway background workers
    try:
        from stitch_backend.domains.ai_gateway.discovery_worker import DiscoveryWorker
        from stitch_backend.domains.ai_gateway.probe_worker import ProbeWorker
        await DiscoveryWorker.start(interval_seconds=3600)
        await ProbeWorker.start(interval_seconds=300)
        logger.info("AI Gateway workers started (discovery=3600s, probe=300s)")
    except Exception as _exc:
        logger.warning("AI Gateway workers init skipped: %s", _exc)

    # Start UserProxyKey last_used_at batch flush (10 s interval).
    # The service batches last_used_at updates in-memory; this task flushes
    # them to the DB periodically to avoid write amplification on the
    # single-writer SQLite connection.  The request path NEVER opens a DB
    # session (avoids write-pool deadlock on pool_size=1); only this
    # background task does the UPDATE.
    async def _proxy_key_flush_loop():
        while True:
            await asyncio.sleep(10)
            try:
                from stitch_backend.domains.ai_gateway.service import flush_last_used_at

                factory = get_session_factory()
                async with factory() as _db:
                    await flush_last_used_at(_db)
                    await _db.commit()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("ProxyKey last_used_at flush failed")

    _proxy_key_flush_task = asyncio.create_task(_proxy_key_flush_loop())

    # Start GroupUsage batch flush (10 s interval).  The usage_tracker
    # batches per-member request/token counts in-memory; this task flushes
    # them to the DB periodically to avoid write amplification on the
    # single-writer SQLite connection.  The request path NEVER opens a DB
    # session (avoids write-pool deadlock on pool_size=1); only this
    # background task does the upserts AND sets the _over_keys flag.
    async def _group_usage_flush_loop():
        while True:
            await asyncio.sleep(10)
            try:
                from stitch_backend.domains.ai_gateway.usage_tracker import flush_group_usage

                factory = get_session_factory()
                async with factory() as _db:
                    await flush_group_usage(_db)
                    await _db.commit()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("GroupUsage flush failed")

    _group_usage_flush_task = asyncio.create_task(_group_usage_flush_loop())

    # Start KeyHealth worker
    try:
        from stitch_backend.domains.key_health.worker import KeyHealthWorker
        await KeyHealthWorker.start()
        logger.info("KeyHealth worker started")
    except Exception as _exc:
        logger.warning("KeyHealth worker init skipped: %s", _exc)

    # Warm the AiApiRadar cache so the first user-facing radar request
    # doesn't wait ~4s on the upstream.  Fire-and-forget; failures only log.
    try:
        from stitch_backend.domains.community.service import warm_radar_cache
        await warm_radar_cache()
        logger.info("AiApiRadar cache warmup scheduled")
    except Exception as _exc:
        logger.warning("AiApiRadar cache warmup skipped: %s", _exc)

    # Emit a startup event for any domain listeners
    from stitch_backend.core.event_bus import event_bus
    event_bus.set_loop(asyncio.get_event_loop())
    await event_bus.emit("app.started", {"port": settings.port})

    yield

    # Shutdown
    logger.info("Stitch Backend shutting down …")

    # Stop replenishment service if running
    try:
        from stitch_backend.domains.replenishment.service import (
            get_replenishment_service as _get_replen,
        )
        await _get_replen().stop()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Replenishment stop failed: %s", _exc)

    # Stop all sidecar subprocesses (turnstile solver, freemodel bridge, ...).
    # stop_all() also fixes the prior bug where the FreeModel bridge was never
    # stopped on shutdown (orphaned subprocess on app exit).
    try:
        from stitch_backend.domains.sidecar import get_supervisor as _get_sidecar_sup

        await _get_sidecar_sup().stop_all()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Sidecar shutdown skipped: %s", _exc)

    # ponytail: native gateway runs with Stitch process; no sidecar shutdown needed
    # Legacy OmniRoute/HoloNe sidecar shutdown removed

    # Stop scheduled worker
    from stitch_backend.domains.scheduler.worker import get_worker
    await get_worker().stop()

    # Stop AI Gateway workers
    try:
        from stitch_backend.domains.ai_gateway.discovery_worker import DiscoveryWorker
        from stitch_backend.domains.ai_gateway.probe_worker import ProbeWorker
        await DiscoveryWorker.stop()
        await ProbeWorker.stop()
    except Exception:
        pass

    # Stop UserProxyKey last_used_at flush task
    try:
        _proxy_key_flush_task.cancel()
        await _proxy_key_flush_task
    except (asyncio.CancelledError, Exception):
        pass

    # Stop GroupUsage flush task
    try:
        _group_usage_flush_task.cancel()
        await _group_usage_flush_task
    except (asyncio.CancelledError, Exception):
        pass

    # Stop KeyHealth worker
    try:
        from stitch_backend.domains.key_health.worker import KeyHealthWorker
        await KeyHealthWorker.stop()
    except Exception:
        pass

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

    # ── Origin guard (security review) ───────────────────────────────────────
    # The dispatcher has no auth layer (localhost desktop model). CORS stops
    # honest browsers but not fetch() from a compromised localhost page with
    # credentials:include — so reject foreign Origins server-side, and require
    # an Origin at all on the secret-decrypting command (raw-socket clients
    # like curl/malware send none; the renderer always sends one).
    _NO_ORIGIN_SENSITIVE = {"/api/get_found_key_secret"}

    @app.middleware("http")
    async def origin_guard(request, call_next):
        if request.url.path.startswith("/api/"):
            origin = request.headers.get("origin")
            if origin is not None and origin not in settings.cors_origin_list:
                return JSONResponse(
                    status_code=403,
                    content={"error": {"message": "origin not allowed"}},
                )
            if origin is None and request.url.path in _NO_ORIGIN_SENSITIVE:
                return JSONResponse(
                    status_code=403,
                    content={"error": {"message": "origin required"}},
                )
        return await call_next(request)

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
        logger.info("Static files found at %s — serving SPA with client-route fallback", dist_dir)
        # Hashed bundles under /assets/ get proper static serving; everything
        # else falls through to the SPA fallback below so client-side routes
        # (e.g. /marketplace) survive a hard refresh. StaticFiles(html=True)
        # alone would 404 unknown paths like /marketplace.
        if (dist_dir / "assets").is_dir():
            app.mount(
                "/assets", StaticFiles(directory=str(dist_dir / "assets")), name="assets"
            )

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str) -> FileResponse:
            """Serve real dist files; unknown paths get index.html (SPA routing)."""
            if full_path:
                candidate = (dist_dir / full_path).resolve()
                if candidate.is_file() and dist_dir in candidate.parents:
                    return FileResponse(candidate)
            return FileResponse(dist_index)
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
        access_log=False,
    )


if __name__ == "__main__":
    run()
