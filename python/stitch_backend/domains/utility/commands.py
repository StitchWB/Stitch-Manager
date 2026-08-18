"""Utility command handlers — app metadata, clipboard, browser, API key validation.

These commands replace the legacy utility commands:
    get_app_version, copy_to_clipboard, open_in_browser, open_url_in_browser,
    get_database_path, get_backend_health, check_fireworks_api_key_rust.
"""

from __future__ import annotations

import logging
import subprocess
import webbrowser
from datetime import UTC
from typing import Any, cast

from stitch_backend import __version__
from stitch_backend.core.command_registry import register_command

# ═════════════════════════════════════════════════════════════════════════════
# App metadata
# ═════════════════════════════════════════════════════════════════════════════

@register_command("get_app_version")
async def cmd_get_app_version(params: dict) -> str:
    """Return app version string (plain str)."""
    return __version__


@register_command("get_backend_health")
async def cmd_get_backend_health(params: dict) -> dict:
    return {
        "status": "ok",
        "backend": "python",
        "version": __version__,
    }


@register_command("get_database_path", admin_only=True)
async def cmd_get_database_path(params: dict) -> str:
    """Return database file path as plain string."""
    from stitch_backend.config import get_database_path as _resolve
    return str(_resolve())


# ═════════════════════════════════════════════════════════════════════════════
# Clipboard / Browser / File Manager
# ═════════════════════════════════════════════════════════════════════════════

@register_command("copy_to_clipboard")
async def cmd_copy_to_clipboard(params: dict) -> dict:
    text = params.get("text", "")
    try:
        # Windows
        process = subprocess.Popen(["clip"], stdin=subprocess.PIPE)
        process.communicate(text.encode("utf-16-le"))
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@register_command("open_in_browser")
async def cmd_open_in_browser(params: dict) -> dict:
    url = params.get("url", "")
    if not url:
        return {"success": False, "error": "No URL provided"}
    webbrowser.open(url)
    return {"success": True}


@register_command("open_url_in_browser")
async def cmd_open_url_in_browser(params: dict) -> dict:
    url = params.get("url", "")
    if not url:
        return {"success": False, "error": "No URL provided"}
    webbrowser.open(url)
    return {"success": True}


@register_command("open_in_file_manager", admin_only=True)
async def cmd_open_in_file_manager(params: dict) -> dict:
    path = params.get("path", "")
    if not path:
        return {"success": False, "error": "No path provided"}
    try:
        subprocess.Popen(["explorer", path])
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@register_command("check_fireworks_api_key_rust")
async def cmd_check_fireworks_api_key(params: dict) -> dict:
    api_key = params.get("apiKey", "")
    valid = api_key.startswith("fw_") and len(api_key) > 10
    return {"valid": valid}


# ═════════════════════════════════════════════════════════════════════════════
# Dashboard stats stub
# ═════════════════════════════════════════════════════════════════════════════

@register_command("get_dashboard_stats", readonly=True)
async def cmd_get_dashboard_stats(params: dict) -> dict:
    """Return basic dashboard statistics."""
    from sqlalchemy import func, select

    from stitch_backend.database import run_in_read_session
    from stitch_backend.domains.accounts.models import Account

    async def _op(session):
        total = await session.execute(select(func.count(Account.id)))
        active = await session.execute(
            select(func.count(Account.id)).where(Account.status == "active")
        )
        return total.scalar() or 0, active.scalar() or 0

    total, active = await run_in_read_session(_op)

    return {
        "totalAccounts": total,
        "activeAccounts": active,
        "totalProviders": 0,
        "registrationsToday": 0,
    }


# =============================================================================
# Active accounts (replaces stubs)
# =============================================================================

# In-memory tracking of active accounts per provider
_ACTIVE_ACCOUNTS: dict[str, str] = {}


@register_command("get_active_accounts", readonly=True)
async def cmd_get_active_accounts(params: dict) -> dict:
    """Return currently active account per provider."""
    return dict(_ACTIVE_ACCOUNTS)


@register_command("set_active_account")
async def cmd_set_active_account(params: dict) -> dict:
    """Set the active account for a provider.

    On successful activation, increments ``use_count`` and sets
    ``last_used_at`` on the account row so usage statistics are tracked.
    """
    provider = params.get("provider", "")
    account_id = params.get("accountId")
    if provider and account_id:
        _ACTIVE_ACCOUNTS[provider] = str(account_id)
    elif provider and account_id is None:
        _ACTIVE_ACCOUNTS.pop(provider, None)

    # Increment use_count + last_used_at on the account
    if account_id:
        from datetime import datetime

        from sqlalchemy import text

        from stitch_backend.database import run_in_session

        now = datetime.now(UTC).isoformat()

        async def _op(session):
            await session.execute(
                text(
                    "UPDATE accounts SET use_count = use_count + 1, "
                    "last_used_at = :now, updated_at = :now "
                    "WHERE id = :id"
                ),
                {"now": now, "id": str(account_id)},
            )

        try:
            await run_in_session(_op)
        except Exception as e:
            # Don't fail the activation if stats update fails
            logging.getLogger(__name__).warning(
                "set_active_account: stats update failed for %s: %s", account_id, e
            )

    return {"success": True, "provider": provider, "accountId": account_id}


# =============================================================================
# IDE paths (replaces stub)
# =============================================================================

@register_command("get_ide_paths")
async def cmd_get_ide_paths(params: dict) -> dict:
    """Detect installed IDEs and return their paths."""
    import os

    paths: dict[str, str] = {}
    # Common IDE locations
    ide_dirs = {
        "vscode": ["Code", "Visual Studio Code"],
        "cursor": ["Cursor"],
        "windsurf": ["Windsurf", "Codeium"],
        "trae": ["Trae"],
        "kiro": ["Kiro"],
    }

    local_app = os.environ.get("LOCALAPPDATA", "")
    program_files = os.environ.get("PROGRAMFILES", "C:\\Program Files")

    for ide_name, dir_names in ide_dirs.items():
        for dn in dir_names:
            for base in [local_app, program_files]:
                if base:
                    candidate = os.path.join(base, dn)
                    if os.path.isdir(candidate):
                        paths[ide_name] = candidate
                        break
            if ide_name in paths:
                break

    return paths


# =============================================================================
# Observability (replaces stubs — backed by app_logs table)
# =============================================================================

@register_command("obs_ingest", admin_only=True)
async def cmd_obs_ingest(params: dict) -> dict:
    """Ingest observability event(s) into app_logs.

    Accepts either a single event (``{"event": {...}}`` or flat params) or
    a batch (``{"events": [{...}, ...]}``).  Single-event calls return the
    created log entry dict (backward compatible).  Batch calls return
    ``{"ingested": N}``.
    """
    from stitch_backend.database import run_in_session
    from stitch_backend.domains.logging.service import LoggingService

    events_raw = params.get("events")
    if isinstance(events_raw, list) and events_raw:
        # Batch mode: ingest all events in a single session.
        async def _batch_op(session):
            svc = LoggingService(session)
            count = 0
            for ev in events_raw:
                if not isinstance(ev, dict):
                    continue
                level = ev.get("level", "info")
                source = ev.get("source") or "observability"
                message = ev.get("message") or ev.get("name") or ""
                details = {
                    k: v
                    for k, v in {
                        "name": ev.get("name"),
                        "subsystem": ev.get("subsystem"),
                        "fields": ev.get("fields"),
                        "error": ev.get("error"),
                        "origin": ev.get("origin"),
                    }.items()
                    if v is not None
                } or None
                await svc.add_log(
                    level=level,
                    source=source,
                    message=message,
                    channel="observability",
                    details=details,
                )
                count += 1
            return {"ingested": count}

        return await run_in_session(_batch_op)

    # Single-event mode (backward compatible).
    event = params.get("event")
    if not isinstance(event, dict):
        event = params

    level = event.get("level", "info")
    source = event.get("source") or "observability"
    message = event.get("message") or event.get("name") or ""
    details = {
        k: v
        for k, v in {
            "name": event.get("name"),
            "subsystem": event.get("subsystem"),
            "fields": event.get("fields"),
            "error": event.get("error"),
            "origin": event.get("origin"),
        }.items()
        if v is not None
    } or None
    return await run_in_session(
        lambda s: LoggingService(s).add_log(
            level=level,
            source=source,
            message=message,
            channel="observability",
            details=details,
        )
    )


@register_command("obs_recent", readonly=True)
async def cmd_obs_recent(params: dict) -> list:
    """Return recent observability events."""
    from stitch_backend.database import run_in_read_session
    from stitch_backend.domains.logging.service import LoggingService

    limit = int(params.get("limit", 50))
    return cast("list[Any]", await cast("Any", run_in_read_session)(
        lambda s: LoggingService(s).query_logs({
            "channels": ["observability"],
            "limit": limit,
        })
    ))


@register_command("obs_timeline", readonly=True)
async def cmd_obs_timeline(params: dict) -> list:
    """Return timeline of observability events."""
    from stitch_backend.database import run_in_read_session
    from stitch_backend.domains.logging.service import LoggingService

    filter_ = params.get("filter", {})
    filter_.setdefault("channels", ["observability", "backend", "app"])
    return cast("list[Any]", await cast("Any", run_in_read_session)(
        lambda s: LoggingService(s).query_logs(filter_)
    ))


# ═════════════════════════════════════════════════════════════════════════════
# App initialization
# ═════════════════════════════════════════════════════════════════════════════

@register_command("initialize_app", readonly=True)
async def cmd_initialize_app(params: dict) -> dict:
    """Return all essential startup data in a single response."""
    import json
    import threading

    from sqlalchemy import func, select, text

    from stitch_backend.database import run_in_read_session
    from stitch_backend.domains.accounts.models import Account
    from stitch_backend.domains.accounts.service import AccountService
    from stitch_backend.domains.background_manager.schemas import (
        BackgroundManagerConfig,
        normalise_background_manager_config,
    )
    from stitch_backend.domains.registration.service import registration_service
    from stitch_backend.domains.scheduler.service import get_tasks, task_to_dict
    from stitch_backend.domains.scheduler.worker import get_worker as get_scheduler_worker
    from stitch_backend.domains.settings.service import SettingsService
    from stitch_backend.domains.totp.models import TotpKey

    async def _op(session):
        # Get settings
        settings = await SettingsService(session).get_all()

        # Get accounts and serialize manually
        accounts_list = await AccountService(session).list_accounts()
        accounts = [acc.model_dump(mode="json", by_alias=True) for acc in accounts_list]

        # Get dashboard stats
        total = await session.execute(select(func.count(Account.id)))
        active = await session.execute(
            select(func.count(Account.id)).where(Account.status == "active")
        )
        total_accounts = total.scalar() or 0
        active_accounts_count = active.scalar() or 0

        # Get TOTP keys
        totp_result = await session.execute(
            select(TotpKey).order_by(TotpKey.created_at)
        )
        totp_keys_list = totp_result.scalars().all()
        from stitch_backend.domains.totp.commands import _key_to_dict
        totp_keys = [_key_to_dict(k, include_secret=True) for k in totp_keys_list]

        # Get scheduled tasks
        tasks_list = await get_tasks(session)
        scheduled_tasks = [task_to_dict(t) for t in tasks_list]

        # Get background manager config
        bg_result = await session.execute(
            text("SELECT value FROM settings WHERE key = 'background_manager_config'")
        )
        bg_row = bg_result.first()
        if bg_row and bg_row[0]:
            try:
                bg_value = json.loads(bg_row[0])
                bg_config = normalise_background_manager_config(bg_value)
                background_manager_config = bg_config.model_dump(mode="json", by_alias=True)
            except (json.JSONDecodeError, TypeError):
                background_manager_config = BackgroundManagerConfig.model_validate({}).model_dump(mode="json", by_alias=True)
        else:
            background_manager_config = BackgroundManagerConfig.model_validate({}).model_dump(mode="json", by_alias=True)

        return {
            "settings": settings,
            "accounts": accounts,
            "activeAccounts": dict(_ACTIVE_ACCOUNTS),
            "dashboardStats": {
                "totalAccounts": total_accounts,
                "activeAccounts": active_accounts_count,
                "totalProviders": 0,
                "registrationsToday": 0,
            },
            "totpKeys": totp_keys,
            "scheduledTasks": scheduled_tasks,
            "backgroundManagerConfig": background_manager_config,
            "status": "ok",
        }

    # Run DB operations in session
    result = await run_in_read_session(_op)

    # Get non-DB data (can be done outside session)
    # Proxy status
    proxy_thread = None
    for thread in threading.enumerate():
        if thread.name == "kiro-proxy":
            proxy_thread = thread
            break

    from stitch_backend.domains.kiro_proxy.commands import _get_proxy_port
    port = _get_proxy_port()
    proxy_status = {
        "running": proxy_thread is not None and proxy_thread.is_alive(),
        "port": port,
    }

    # Scheduler status
    scheduler_status = get_scheduler_worker().is_running

    # Registration status and jobs
    running_jobs = [
        j for j in registration_service.list_jobs()
        if j.get("state") == "running"
    ]
    if running_jobs:
        job = running_jobs[0]
        registration_status = {
            "isRunning": True,
            "success": None,
            "status": "running",
            "provider": job.get("provider"),
            "email": job.get("email"),
            "step": job.get("step"),
            "progress": job.get("progress"),
            "error": None,
            "startedAt": job.get("created_at"),
            "completedAt": None,
        }
    else:
        all_jobs = registration_service.list_jobs()
        if all_jobs:
            job = all_jobs[0]
            success = job.get("state") == "succeeded"
            registration_status = {
                "isRunning": False,
                "success": success,
                "status": job.get("state"),
                "provider": job.get("provider"),
                "email": job.get("email"),
                "step": job.get("step", "done"),
                "progress": job.get("progress", 100),
                "error": job.get("error"),
                "startedAt": job.get("created_at"),
                "completedAt": job.get("completed_at"),
            }
        else:
            registration_status = {
                "isRunning": False, "success": None, "status": None,
                "provider": None, "email": None, "step": None,
                "progress": None, "error": None,
                "startedAt": None, "completedAt": None,
            }

    registration_jobs = [
        registration_service.to_frontend_dict(j)
        for j in registration_service.list_jobs()
    ]

    # Merge into result
    result["proxyStatus"] = proxy_status
    result["schedulerStatus"] = scheduler_status
    result["registrationStatus"] = registration_status
    result["registrationJobs"] = registration_jobs

    return cast("dict[Any, Any]", result)


# =============================================================================
# Proxy config (replaces stubs — backed by settings table)
# =============================================================================

@register_command("get_proxy_config", readonly=True)
async def cmd_get_proxy_config(params: dict) -> dict:
    """Return proxy configuration from settings."""
    import json

    from sqlalchemy import text

    from stitch_backend.database import run_in_read_session

    async def _op(session):
        result = await session.execute(
            text("SELECT value FROM settings WHERE key = 'proxy_config'")
        )
        row = result.first()
        if row and row[0]:
            try:
                return json.loads(row[0])
            except (json.JSONDecodeError, TypeError):
                pass
        return {"enabled": False, "proxyType": "http", "proxies": []}

    return await run_in_read_session(_op)


@register_command("save_proxy_config")
async def cmd_save_proxy_config(params: dict) -> None:
    """Persist proxy configuration to settings."""
    import json

    from sqlalchemy import text

    from stitch_backend.database import run_in_session

    config_json = json.dumps(params)

    async def _op(session):
        await session.execute(
            text(
                "INSERT INTO settings (key, value) VALUES ('proxy_config', :v) "
                "ON CONFLICT(key) DO UPDATE SET value = :v"
            ),
            {"v": config_json},
        )

    await run_in_session(_op)


@register_command("get_proxy_settings", readonly=True)
async def cmd_get_proxy_settings(params: dict) -> dict:
    """Return AI proxy settings from settings table."""
    import json

    from sqlalchemy import text

    from stitch_backend.database import run_in_read_session

    async def _op(session):
        result = await session.execute(
            text("SELECT value FROM settings WHERE key = 'proxy_settings'")
        )
        row = result.first()
        if row and row[0]:
            try:
                return json.loads(row[0])
            except (json.JSONDecodeError, TypeError):
                pass
        return {
            "appMode": "disabled",
            "proxyPort": 0,
            "autoStart": False,
            "routingStrategy": "round_robin",
            "managementKey": "",
        }

    return await run_in_read_session(_op)


@register_command("update_proxy_settings")
async def cmd_update_proxy_settings(params: dict) -> None:
    """Persist AI proxy settings to settings table."""
    import json

    from sqlalchemy import text

    from stitch_backend.database import run_in_session

    settings_json = json.dumps(params)

    async def _op(session):
        await session.execute(
            text(
                "INSERT INTO settings (key, value) VALUES ('proxy_settings', :v) "
                "ON CONFLICT(key) DO UPDATE SET value = :v"
            ),
            {"v": settings_json},
        )

    await run_in_session(_op)


# =============================================================================
# Proxy debug logs (replaces stubs — backed by app_logs table)
# =============================================================================

@register_command("get_proxy_debug_logs", readonly=True)
async def cmd_get_proxy_debug_logs(params: dict) -> list:
    """Return proxy debug logs from app_logs table."""
    from stitch_backend.database import run_in_read_session
    from stitch_backend.domains.logging.service import LoggingService

    limit = int(params.get("limit", 100))
    result = await run_in_read_session(
        lambda s: LoggingService(s).query_logs({
            "channels": ["proxy"],
            "limit": limit,
        })
    )
    return cast("list[Any]", cast("dict[Any, Any]", result).get("logs", []))


@register_command("clear_proxy_debug_logs")
async def cmd_clear_proxy_debug_logs(params: dict) -> int:
    """Clear proxy debug logs from app_logs table."""
    from stitch_backend.database import run_in_session
    from stitch_backend.domains.logging.service import LoggingService

    return await run_in_session(
        lambda s: LoggingService(s).clear_logs()
    )


# =============================================================================
# Request history (replaces stubs — backed by app_logs table)
# =============================================================================

@register_command("get_request_history", readonly=True)
async def cmd_get_request_history(params: dict) -> dict:
    """Return AI proxy request history from app_logs."""
    from stitch_backend.database import run_in_read_session
    from stitch_backend.domains.logging.service import LoggingService

    limit = int(params.get("limit", 50))
    result = await run_in_read_session(
        lambda s: LoggingService(s).query_logs({
            "sources": ["ai_proxy", "proxy"],
            "limit": limit,
        })
    )
    logs = result.get("logs", [])
    return {"items": logs, "total": result.get("total", 0)}


@register_command("clear_request_history")
async def cmd_clear_request_history(params: dict) -> None:
    """Clear AI proxy request history."""
    from stitch_backend.database import run_in_session
    from stitch_backend.domains.logging.service import LoggingService

    await run_in_session(
        lambda s: LoggingService(s).clear_logs()
    )
