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


async def bootstrap(*, log_to_stderr: bool = False) -> None:
    """Initialise the Stitch backend for standalone use (no HTTP server).

    Idempotent — safe to call multiple times.  With ``log_to_stderr`` all log
    records go to stderr, keeping stdout free for a protocol channel such as
    the MCP stdio transport.
    """
    from stitch_backend.config import get_settings

    settings = get_settings()

    # ── Logging ──────────────────────────────────────────────────────────────
    _configure_logging(settings.log_level, log_to_stderr=log_to_stderr)

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

    # ── SPI built-ins ────────────────────────────────────────────────────────
    # Register the built-in EmailVerificationProvider before any command
    # module that might resolve it.  (No built-in MailInboxSPI — the
    # stitch-mail plugin is the only provider.)
    import stitch_backend.core.spi_builtin_email  # noqa: F401

    # ── Command modules ──────────────────────────────────────────────────────
    # Single source of truth for command modules — the HTTP app imports the same list.
    from stitch_backend.startup import import_command_modules

    import_command_modules()

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

    # ── Outlook mailbox pool ─────────────────────────────────────────────────
    try:
        from stitch_backend.domains.outlook_mailbox_pool.service import (
            get_outlook_mailbox_pool_service,
        )

        get_outlook_mailbox_pool_service().register_bridge()
    except ImportError:
        logger.debug("Outlook mailbox pool init skipped: autoreg not available")
    except Exception as _exc:
        logger.warning("Outlook mailbox pool init skipped: %s", _exc)

    # ── Event bus ────────────────────────────────────────────────────────────
    from stitch_backend.core.event_bus import event_bus

    event_bus.set_loop(asyncio.get_event_loop())
    await event_bus.emit("app.started", {"port": settings.port})


# ── Internal ──────────────────────────────────────────────────────────────────


def _configure_logging(level: str, *, log_to_stderr: bool = False) -> None:
    """Configure logging. INFO goes to stdout, ERROR/WARNING to stderr.

    With ``log_to_stderr`` every record goes to stderr instead, keeping stdout
    free for callers that use it as a data channel (MCP stdio transport).
    """
    import sys

    formatter = logging.Formatter(
        "%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
        datefmt="%H:%M:%S",
    )

    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    if log_to_stderr:
        handler = logging.StreamHandler(sys.stderr)
        handler.setLevel(logging.DEBUG)
        handler.setFormatter(formatter)
        root_logger.addHandler(handler)
    else:
        stdout_handler = logging.StreamHandler(sys.stdout)
        stdout_handler.setLevel(logging.DEBUG)
        stdout_handler.addFilter(lambda record: record.levelno < logging.WARNING)
        stdout_handler.setFormatter(formatter)

        stderr_handler = logging.StreamHandler(sys.stderr)
        stderr_handler.setLevel(logging.WARNING)
        stderr_handler.setFormatter(formatter)

        root_logger.addHandler(stdout_handler)
        root_logger.addHandler(stderr_handler)

    logging.getLogger("stitch_backend.core.command_registry").setLevel(logging.ERROR)
