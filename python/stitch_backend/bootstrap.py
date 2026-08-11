"""Reusable bootstrap — initialise the backend without starting the HTTP server.

Import this and call ``await bootstrap()`` to set up the database, command
registry, and provider plugins before using the CLI, MCP server, or any other
non-HTTP entry point.

Usage::

    import asyncio
    from stitch_backend.bootstrap import bootstrap
    asyncio.run(bootstrap())

The main.py lifespan calls the same sequence during startup.
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


async def bootstrap() -> None:
    """Initialise the Stitch backend for standalone use (no HTTP server).

    Idempotent — safe to call multiple times.
    """
    from stitch_backend.config import get_settings

    settings = get_settings()

    # ── Logging ──────────────────────────────────────────────────────────────
    _configure_logging(settings.log_level)

    try:
        from stitch_backend.version import __version__

        logger.info(
            "Stitch Backend v%s bootstrapping — db=%s",
            __version__,
            settings.database_url,
        )
    except ImportError:
        logger.info("Stitch Backend (dev) bootstrapping — db=%s", settings.database_url)

    # ── Database ─────────────────────────────────────────────────────────────
    from stitch_backend.database import create_all_tables

    await create_all_tables()

    # Scheduler tables (raw SQL, not ORM models)
    from stitch_backend.database import get_session_factory
    from stitch_backend.domains.scheduler.service import ensure_tables as _sched_tables

    factory = get_session_factory()
    async with factory() as _db:
        await _sched_tables(_db)

    # ── Command modules ──────────────────────────────────────────────────────
    # Import so @register_command decorators fire
    import stitch_backend.domains.account_status.commands  # noqa: F401
    import stitch_backend.domains.accounts.commands  # noqa: F401
    import stitch_backend.domains.activation.commands  # noqa: F401
    import stitch_backend.domains.ai_proxy.commands  # noqa: F401
    import stitch_backend.domains.ai_proxy.zai_token_commands  # noqa: F401
    import stitch_backend.domains.api_keys.commands  # noqa: F401
    import stitch_backend.domains.aws_accounts.commands  # noqa: F401
    import stitch_backend.domains.background_manager.commands  # noqa: F401
    import stitch_backend.domains.browser.commands  # noqa: F401
    import stitch_backend.domains.cards.commands  # noqa: F401
    import stitch_backend.domains.composed_flows.commands  # noqa: F401
    import stitch_backend.domains.email.commands  # noqa: F401
    import stitch_backend.domains.email_counter.commands  # noqa: F401
    import stitch_backend.domains.email_inbox.commands  # noqa: F401
    import stitch_backend.domains.freemodel_bridge.commands  # noqa: F401
    import stitch_backend.domains.google_sheets.commands  # noqa: F401
    import stitch_backend.domains.google_sheets.oauth_commands  # noqa: F401
    import stitch_backend.domains.icloud_email_pool.commands  # noqa: F401
    import stitch_backend.domains.key_health.commands  # noqa: F401
    import stitch_backend.domains.kiro_patch.commands  # noqa: F401
    import stitch_backend.domains.logging.commands  # noqa: F401
    import stitch_backend.domains.mcp_bridge.commands  # noqa: F401
    import stitch_backend.domains.oauth.commands  # noqa: F401
    import stitch_backend.domains.opencode_config.commands  # noqa: F401
    import stitch_backend.domains.patcher.commands  # noqa: F401  # noqa: F401
    import stitch_backend.domains.plugin_distribution.commands  # noqa: F401
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
    import stitch_backend.domains.utility.commands  # noqa: F401
    import stitch_backend.domains.utility.file_dialogs  # noqa: F401
    import stitch_backend.domains.utility.stubs  # noqa: F401

    # ── Registry scan ────────────────────────────────────────────────────────
    from stitch_backend.core.command_registry import list_commands, scan_providers

    commands = list_commands()
    logger.info("Registered %d command(s)", len(commands))
    logger.debug("Registered commands: %s", commands)

    providers = scan_providers()
    if providers:
        logger.info(
            "Discovered %d provider(s): %s", len(providers), list(providers.keys())
        )

    # ── Command metadata ─────────────────────────────────────────────────────
    # Extract Pydantic models, categories, and descriptions from handlers
    from stitch_backend.core.command_meta import build_command_meta

    build_command_meta()

    # ── iCloud pool ──────────────────────────────────────────────────────────
    try:
        from stitch_backend.database import get_session_factory as _gsf
        from stitch_backend.domains.icloud_email_pool.service import get_icloud_pool_service

        icloud_svc = get_icloud_pool_service()
        icloud_svc.register_bridge()

        async def _load_icloud_settings() -> None:
            factory = _gsf()
            async with factory() as _db:
                from stitch_backend.domains.settings.service import SettingsService

                _settings = await SettingsService(_db).get_all()
            apple_id = _settings.get("icloudAppleId", "")
            app_pw = _settings.get("icloudAppPassword", "")
            enabled = _settings.get("icloudEnabled", False)
            if enabled and apple_id and app_pw and app_pw != "********":
                icloud_svc.configure(apple_id=apple_id, app_password=app_pw)
                logger.info("iCloud pool service pre-configured for %s", apple_id)

        await _load_icloud_settings()
    except ImportError:
        logger.debug("iCloud pool service init skipped: autoreg not available")
    except Exception as _exc:
        logger.warning("iCloud pool service init skipped: %s", _exc)

    # ── Event bus ────────────────────────────────────────────────────────────
    from stitch_backend.core.event_bus import event_bus

    event_bus.set_loop(asyncio.get_event_loop())
    await event_bus.emit("app.started", {"port": settings.port})


# ── Internal ──────────────────────────────────────────────────────────────────


def _configure_logging(level: str) -> None:
    """Configure logging to write INFO to stdout, ERROR/WARNING to stderr."""
    import sys

    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setLevel(logging.DEBUG)
    stdout_handler.addFilter(lambda record: record.levelno < logging.WARNING)

    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setLevel(logging.WARNING)

    formatter = logging.Formatter(
        "%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
        datefmt="%H:%M:%S",
    )
    stdout_handler.setFormatter(formatter)
    stderr_handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(level)
    root_logger.addHandler(stdout_handler)
    root_logger.addHandler(stderr_handler)

    logging.getLogger("stitch_backend.core.command_registry").setLevel(logging.ERROR)
