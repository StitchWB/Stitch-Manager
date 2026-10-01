"""Lifespan step helpers for the FastAPI app.

Each function is one startup or shutdown step called from
:func:`stitch_backend.main.lifespan` in a fixed, load-bearing order.
Fault-isolated steps (try/except + warning) must never fail the boot;
unwrapped steps propagate errors by design.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from stitch_backend.config import Settings

logger = logging.getLogger(__name__)


async def log_startup_banner(settings: Settings) -> None:
    try:
        from stitch_backend.version import __version__
        logger.info("Stitch Backend v%s starting — port=%d  db=%s", __version__, settings.port, settings.database_url)
    except ImportError:
        logger.info("Stitch Backend (dev) starting — port=%d  db=%s", settings.port, settings.database_url)


async def seed_permission_defaults() -> None:
    # Idempotent: also inserts keys added by upgrades so new keys appear automatically.
    try:
        from stitch_backend.database import get_session_factory
        from stitch_backend.domains.auth.permissions import seed_defaults

        factory = get_session_factory()
        async with factory() as _db:
            await seed_defaults(_db)
            await _db.commit()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Permission seed skipped: %s", _exc)


async def bootstrap_initial_admin(settings: Settings) -> None:
    # No-op when auth is off (desktop single-user mode); password is never logged.
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


async def migrate_plaintext_secrets() -> None:
    # Idempotent: re-encrypts plaintext rows left from before EncryptedText, skips encrypted ones.
    try:
        from stitch_backend.security.fernet_at_rest import migrate_plaintext_to_encrypted
        await migrate_plaintext_to_encrypted()
    except Exception as _exc:
        logger.error("Encrypted-at-rest migration failed: %s", _exc)


async def run_legacy_auto_migration() -> None:
    """L2 final wave: drain ``ai_proxy_accounts`` → ai_gateway credentials.

    Delegates to :func:`legacy_accounts_api.run_final_conversion` which:
    - Checks if the legacy table exists (PRAGMA) and has rows.
    - Converts each row via ``create_account`` (dedupes by fingerprint).
    - On success: DELETE the rows (table stays empty/inert, never dropped).
    - On failure: warn + keep rows + set ``conversion_failed`` flag.

    Idempotent — safe to call on every boot. On any exception → warning +
    continue (boot must never fail).
    """
    try:
        from stitch_backend.database import get_session_factory
        from stitch_backend.domains.ai_proxy.legacy_accounts_api import (
            run_final_conversion,
        )

        factory = get_session_factory()
        async with factory() as _db:
            counts = await run_final_conversion(_db)
            if counts["legacy_rows"] > 0:
                await _db.commit()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Legacy auto-migration skipped: %s", _exc)


async def migrate_legacy_group_usage() -> None:
    # Idempotent (INSERT OR IGNORE) copy into group_usage_by_model (model='').
    try:
        from stitch_backend.database import get_session_factory
        from stitch_backend.domains.ai_gateway.usage_tracker import (
            migrate_legacy_group_usage,
        )

        factory = get_session_factory()
        async with factory() as _db:
            await migrate_legacy_group_usage(_db)
            await _db.commit()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("group_usage migration skipped: %s", _exc)


async def convert_legacy_labels() -> None:
    # Runs after the legacy auto-migration so freshly migrated rows get converted too.
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


async def auto_create_public_models() -> None:
    # Success removes the LiteLLM-config fallback in litellm_executor.models(); failure keeps it.
    try:
        from stitch_backend.domains.ai_proxy.litellm_executor import (
            auto_create_public_models_from_config,
        )
        await auto_create_public_models_from_config()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("PublicModel auto-create skipped: %s", _exc)


async def run_plugin_distribution_startup() -> None:
    # Activate → heartbeat → sync; never blocks startup.
    try:
        from stitch_backend.domains.plugin_distribution import run_startup_sequence
        await run_startup_sequence()
    except Exception as _exc:
        logger.warning("Plugin distribution startup skipped: %s", _exc)


async def seed_partner_channels() -> None:
    # Idempotent by url; afterwards admin CRUD on the server is the source of truth.
    try:
        from stitch_backend.domains.community.partner_service import (
            seed_partner_channels,
        )
        await seed_partner_channels()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Partner channel seed skipped: %s", _exc)


async def ensure_scheduler_tables() -> None:
    # Raw SQL, not ORM models.
    from stitch_backend.database import get_session_factory
    from stitch_backend.domains.scheduler.service import ensure_tables as _sched_tables
    factory = get_session_factory()
    async with factory() as _db:
        await _sched_tables(_db)


def import_command_modules() -> None:
    # Import command modules so @register_command decorators fire.
    import stitch_backend.domains.account_status.commands  # noqa: F401
    import stitch_backend.domains.accounts.commands  # noqa: F401
    import stitch_backend.domains.activation.commands  # noqa: F401
    import stitch_backend.domains.ai_gateway.commands  # noqa: F401
    import stitch_backend.domains.ai_gateway.migration_commands  # noqa: F401
    import stitch_backend.domains.ai_proxy.commands  # noqa: F401
    import stitch_backend.domains.ai_proxy.zai_token_commands  # noqa: F401
    import stitch_backend.domains.api_keys.commands  # noqa: F401
    import stitch_backend.domains.auth.commands  # noqa: F401
    import stitch_backend.domains.auth.telegram_commands  # noqa: F401
    import stitch_backend.domains.aws_accounts.commands  # noqa: F401
    import stitch_backend.domains.background_manager.commands  # noqa: F401
    import stitch_backend.domains.browser.commands  # noqa: F401
    import stitch_backend.domains.community.commands  # noqa: F401
    import stitch_backend.domains.composed_flows.commands  # noqa: F401
    import stitch_backend.domains.email.commands  # noqa: F401
    import stitch_backend.domains.google_sheets.oauth_commands  # noqa: F401
    import stitch_backend.domains.groups.commands  # noqa: F401
    import stitch_backend.domains.icloud_email_pool.commands  # noqa: F401
    import stitch_backend.domains.key_health.commands  # noqa: F401
    import stitch_backend.domains.keys.commands  # noqa: F401
    import stitch_backend.domains.kiro_patch.commands  # noqa: F401
    import stitch_backend.domains.kiro_proxy.commands  # noqa: F401
    import stitch_backend.domains.logging.commands  # noqa: F401
    import stitch_backend.domains.mcp_bridge.commands  # noqa: F401
    import stitch_backend.domains.oauth.commands  # noqa: F401
    import stitch_backend.domains.patcher.commands  # noqa: F401
    import stitch_backend.domains.plugin_distribution.commands  # noqa: F401
    import stitch_backend.domains.plugin_distribution.community_commands  # noqa: F401
    import stitch_backend.domains.plugin_distribution.grant_commands  # noqa: F401
    import stitch_backend.domains.plugin_distribution.local_install_commands  # noqa: F401
    import stitch_backend.domains.plugin_distribution.marketplace_commands  # noqa: F401
    import stitch_backend.domains.plugin_distribution.override_commands  # noqa: F401
    import stitch_backend.domains.plugin_distribution.source_commands  # noqa: F401
    import stitch_backend.domains.plugin_distribution.submission_commands  # noqa: F401
    import stitch_backend.domains.plugin_runtime.sandbox_commands  # noqa: F401

    # Imported after totp.commands so the explicit install finds and wraps the registered built-ins.
    import stitch_backend.domains.plugin_runtime.totp_dual  # noqa: F401
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
    from stitch_backend.domains.plugin_runtime.totp_dual import (
        install_totp_dual_routing,
    )

    install_totp_dual_routing()
    import stitch_backend.domains.turnstile_solver.commands  # noqa: F401
    import stitch_backend.domains.utility.commands  # noqa: F401
    import stitch_backend.domains.utility.file_dialogs  # noqa: F401
    import stitch_backend.domains.utility.stubs  # noqa: F401
    from stitch_backend.core.command_registry import get_command_meta, list_commands
    commands = list_commands()
    readonly_count = sum(1 for c in commands if get_command_meta(c).readonly)
    logger.info("Registered %d command(s), %d readonly", len(commands), readonly_count)
    logger.debug("Registered commands: %s", commands)


def register_turnstile_sidecar() -> None:
    # Registers sidecar specs with the supervisor so stop_all() on shutdown knows every sidecar.
    try:
        from stitch_backend.domains.turnstile_solver.service import (
            register_sidecar as _register_turnstile,
        )

        _register_turnstile()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Sidecar registration skipped: %s", _exc)


async def start_service_plugins() -> None:
    # Scans plugins-local/ (unsigned in dev) and plugins/ (signed); unhealthy plugins are skipped.
    try:
        from stitch_backend.domains.plugin_runtime.discovery import (
            start_service_plugins,
        )

        await start_service_plugins()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Service plugin discovery skipped: %s", _exc)


async def ensure_local_chat_token() -> None:
    # Per-install token replaces the shared static bearer for the chat endpoint.
    try:
        from stitch_backend.domains.ai_proxy.chat_router import (
            ensure_local_chat_token as _ensure_chat_token,
        )

        await _ensure_chat_token()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Local chat token init skipped: %s", _exc)


def prewarm_shardx() -> None:
    # Prewarms the ~1s shardx import so the first browser probe/launch doesn't stall the UI.
    import threading as _threading

    def _prewarm_shardx() -> None:
        try:
            import shardx  # noqa: F401
        except Exception:  # noqa: BLE001 — optional dependency
            pass

    _threading.Thread(target=_prewarm_shardx, daemon=True, name="shardx-prewarm").start()


def log_discovered_providers() -> None:
    from stitch_backend.core.command_registry import scan_providers
    providers = scan_providers()
    if providers:
        logger.info("Discovered %d provider(s): %s", len(providers), list(providers.keys()))


async def init_icloud_pool() -> None:
    # Registers the bridge, then restores saved credentials for automatic re-authentication.
    try:
        from stitch_backend.database import get_session_factory as _gsf
        from stitch_backend.domains.icloud_email_pool.service import get_icloud_pool_service
        icloud_svc = get_icloud_pool_service()
        icloud_svc.register_bridge()

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


async def restore_holone_config() -> None:
    # Restores persisted config (enabled/mode) into the singleton.
    try:
        from stitch_backend.database import get_session_factory as _gsf_holone
        from stitch_backend.domains.ai_proxy.holone_service import get_holone_service

        _factory = _gsf_holone()
        async with _factory() as _db:
            from stitch_backend.domains.settings.service import SettingsService

            _hs = await SettingsService(_db).get_all()
        _svc = get_holone_service()
        if _hs.get("holone_enabled") is not None:
            _svc.config.enabled = bool(_hs["holone_enabled"])
        if _hs.get("holone_mode"):
            _svc.config.mode = str(_hs["holone_mode"])
    except Exception as _exc:
        logger.warning("HoloNe config restore skipped: %s", _exc)


async def restore_compression_config() -> None:
    # Restores persisted config into the cached singleton.
    try:
        from stitch_backend.database import get_session_factory as _gsf_comp
        from stitch_backend.domains.ai_proxy.compression.service import (
            get_compression_service,
        )

        _factory = _gsf_comp()
        async with _factory() as _db:
            from stitch_backend.domains.settings.service import SettingsService

            _cs = await SettingsService(_db).get_all()
        _csvc = get_compression_service()
        _flag_map = {
            "compressionEnabled": "enabled",
            "rtkEnabled": "rtk_enabled",
            "cavemanEnabled": "caveman_enabled",
            "inputCompressionEnabled": "input_compression_enabled",
            "outputCompressionEnabled": "output_compression_enabled",
            "preserveSystemPrompt": "preserve_system_prompt",
        }
        for _key, _attr in _flag_map.items():
            if _cs.get(_key) is not None:
                setattr(_csvc.config, _attr, bool(_cs[_key]))
        if _cs.get("cavemanLevel"):
            _csvc.config.caveman_level = str(_cs["cavemanLevel"])
        if _cs.get("autoTriggerThreshold") is not None:
            _csvc.config.auto_trigger_threshold = int(_cs["autoTriggerThreshold"])
    except Exception as _exc:
        logger.warning("Compression config restore skipped: %s", _exc)


async def start_gateway_workers() -> None:
    try:
        from stitch_backend.domains.ai_gateway.discovery_worker import DiscoveryWorker
        from stitch_backend.domains.ai_gateway.probe_worker import ProbeWorker
        await DiscoveryWorker.start(interval_seconds=3600)
        await ProbeWorker.start(interval_seconds=300)
        logger.info("AI Gateway workers started (discovery=3600s, probe=300s)")
    except Exception as _exc:
        logger.warning("AI Gateway workers init skipped: %s", _exc)


async def start_key_health_worker() -> None:
    try:
        from stitch_backend.domains.key_health.worker import KeyHealthWorker
        await KeyHealthWorker.start()
        logger.info("KeyHealth worker started")
    except Exception as _exc:
        logger.warning("KeyHealth worker init skipped: %s", _exc)


async def emit_app_started(settings: Settings) -> None:
    from stitch_backend.core.event_bus import event_bus
    event_bus.set_loop(asyncio.get_event_loop())
    await event_bus.emit("app.started", {"port": settings.port})


async def stop_replenishment_service() -> None:
    try:
        from stitch_backend.domains.replenishment.service import (
            get_replenishment_service as _get_replen,
        )
        await _get_replen().stop()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Replenishment stop failed: %s", _exc)


async def stop_plugin_hosts_and_sidecars() -> None:
    # Hosts stop first (pre-set _stopping) so crash monitors don't race the supervisor kill-tree.
    try:
        from stitch_backend.domains.plugin_runtime.sandbox import (
            stop_all_sandbox as _stop_sandbox,
        )

        await _stop_sandbox()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Sandbox plugin shutdown skipped: %s", _exc)
    try:
        from stitch_backend.domains.plugin_runtime import stop_all as _stop_plugins

        await _stop_plugins()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Service plugin shutdown skipped: %s", _exc)
    try:
        from stitch_backend.domains.sidecar import get_supervisor as _get_sidecar_sup

        await _get_sidecar_sup().stop_all()
    except Exception as _exc:  # noqa: BLE001
        logger.warning("Sidecar shutdown skipped: %s", _exc)


async def stop_scheduler_worker() -> None:
    from stitch_backend.domains.scheduler.worker import get_worker
    await get_worker().stop()


async def stop_gateway_workers() -> None:
    try:
        from stitch_backend.domains.ai_gateway.discovery_worker import DiscoveryWorker
        from stitch_backend.domains.ai_gateway.probe_worker import ProbeWorker
        await DiscoveryWorker.stop()
        await ProbeWorker.stop()
    except Exception:
        pass


async def stop_key_health_worker() -> None:
    try:
        from stitch_backend.domains.key_health.worker import KeyHealthWorker
        await KeyHealthWorker.stop()
    except Exception:
        pass


async def emit_app_stopping() -> None:
    from stitch_backend.core.event_bus import event_bus
    await event_bus.emit("app.stopping", {})
