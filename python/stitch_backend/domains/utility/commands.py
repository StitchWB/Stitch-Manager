"""Utility command handlers — app metadata, clipboard, browser, validators.

These commands replace the Tauri utility commands:
    get_app_version, copy_to_clipboard, open_in_browser, open_url_in_browser,
    get_database_path, get_backend_health, validate_email_rust, etc.
"""

from __future__ import annotations

import re
import subprocess
import webbrowser

from stitch_backend import __version__
from stitch_backend.core.command_registry import register_command


# ═════════════════════════════════════════════════════════════════════════════
# App metadata
# ═════════════════════════════════════════════════════════════════════════════

@register_command("get_app_version")
async def cmd_get_app_version(params: dict) -> str:
    """Return app version string (matches Rust: plain String)."""
    return __version__


@register_command("get_backend_health")
async def cmd_get_backend_health(params: dict) -> dict:
    return {
        "status": "ok",
        "backend": "python",
        "version": __version__,
    }


@register_command("get_database_path")
async def cmd_get_database_path(params: dict) -> str:
    """Return database file path as plain string (matches Rust: String)."""
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


@register_command("open_in_file_manager")
async def cmd_open_in_file_manager(params: dict) -> dict:
    path = params.get("path", "")
    if not path:
        return {"success": False, "error": "No path provided"}
    try:
        subprocess.Popen(["explorer", path])
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ═════════════════════════════════════════════════════════════════════════════
# Validators (replacing Rust validate_* commands)
# ═════════════════════════════════════════════════════════════════════════════

@register_command("validate_email_rust")
async def cmd_validate_email(params: dict) -> dict:
    email = params.get("email", "")
    pattern = r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
    valid = bool(re.match(pattern, email))
    return {"valid": valid, "email": email}


@register_command("validate_password_rust")
async def cmd_validate_password(params: dict) -> dict:
    password = params.get("password", "")
    min_length = params.get("minLength", 8)
    valid = len(password) >= min_length
    errors = []
    if not valid:
        errors.append(f"Password must be at least {min_length} characters")
    return {"valid": valid, "errors": errors}


@register_command("validate_name_rust")
async def cmd_validate_name(params: dict) -> dict:
    name = params.get("name", "")
    valid = bool(name.strip()) and len(name.strip()) >= 2
    return {"valid": valid, "name": name}


@register_command("validate_verification_code_rust")
async def cmd_validate_verification_code(params: dict) -> dict:
    code = params.get("code", "")
    valid = bool(re.match(r"^\d{4,8}$", code))
    return {"valid": valid, "code": code}


@register_command("validate_registration_data_rust")
async def cmd_validate_registration_data(params: dict) -> dict:
    email = params.get("email", "")
    password = params.get("password", "")
    errors = []
    if not re.match(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", email):
        errors.append("Invalid email format")
    if len(password) < 8:
        errors.append("Password must be at least 8 characters")
    return {"valid": len(errors) == 0, "errors": errors}


@register_command("check_fireworks_api_key_rust")
async def cmd_check_fireworks_api_key(params: dict) -> dict:
    api_key = params.get("apiKey", "")
    valid = api_key.startswith("fw_") and len(api_key) > 10
    return {"valid": valid}


# ═════════════════════════════════════════════════════════════════════════════
# Token counter stubs (Phase 2 — real implementation in Phase 6)
# ═════════════════════════════════════════════════════════════════════════════

@register_command("count_tokens_rust")
async def cmd_count_tokens(params: dict) -> dict:
    text = params.get("text", "")
    # Rough estimate: ~4 chars per token
    estimated = max(1, len(text) // 4)
    return {"count": estimated, "model": "estimate"}


@register_command("estimate_tokens_rust")
async def cmd_estimate_tokens(params: dict) -> dict:
    text = params.get("text", "")
    estimated = max(1, len(text) // 4)
    return {"estimate": estimated}


@register_command("count_message_tokens_rust")
async def cmd_count_message_tokens(params: dict) -> dict:
    messages = params.get("messages", [])
    total = sum(max(1, len(m.get("content", "")) // 4) for m in messages)
    return {"count": total}


@register_command("estimate_message_tokens_rust")
async def cmd_estimate_message_tokens(params: dict) -> dict:
    messages = params.get("messages", [])
    total = sum(max(1, len(m.get("content", "")) // 4) for m in messages)
    return {"estimate": total}


# ═════════════════════════════════════════════════════════════════════════════
# Dashboard stats stub
# ═════════════════════════════════════════════════════════════════════════════

@register_command("get_dashboard_stats")
async def cmd_get_dashboard_stats(params: dict) -> dict:
    """Return basic dashboard statistics."""
    from stitch_backend.database import run_in_session
    from stitch_backend.domains.accounts.models import Account
    from sqlalchemy import select, func

    async def _op(session):
        total = await session.execute(select(func.count(Account.id)))
        active = await session.execute(
            select(func.count(Account.id)).where(Account.status == "active")
        )
        return total.scalar() or 0, active.scalar() or 0

    total, active = await run_in_session(_op)

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


@register_command("get_active_accounts")
async def cmd_get_active_accounts(params: dict) -> dict:
    """Return currently active account per provider."""
    return dict(_ACTIVE_ACCOUNTS)


@register_command("set_active_account")
async def cmd_set_active_account(params: dict) -> dict:
    """Set the active account for a provider."""
    provider = params.get("provider", "")
    account_id = params.get("accountId")
    if provider and account_id:
        _ACTIVE_ACCOUNTS[provider] = str(account_id)
    elif provider and account_id is None:
        _ACTIVE_ACCOUNTS.pop(provider, None)
    return {"success": True, "provider": provider, "accountId": account_id}


# =============================================================================
# IDE paths (replaces stub)
# =============================================================================

@register_command("get_ide_paths")
async def cmd_get_ide_paths(params: dict) -> dict:
    """Detect installed IDEs and return their paths."""
    import os
    from pathlib import Path
    from stitch_backend.config import REPO_ROOT

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

@register_command("obs_ingest")
async def cmd_obs_ingest(params: dict) -> dict:
    """Ingest an observability event into app_logs."""
    from stitch_backend.domains.logging.service import LoggingService
    from stitch_backend.database import run_in_session

    level = params.get("level", "info")
    source = params.get("source", "observability")
    message = params.get("message", "")
    return await run_in_session(
        lambda s: LoggingService(s).add_log(
            level=level,
            source=source,
            message=message,
            channel="observability",
            details=params.get("details"),
        )
    )


@register_command("obs_recent")
async def cmd_obs_recent(params: dict) -> list:
    """Return recent observability events."""
    from stitch_backend.domains.logging.service import LoggingService
    from stitch_backend.database import run_in_session

    limit = int(params.get("limit", 50))
    return await run_in_session(
        lambda s: LoggingService(s).query_logs({
            "channels": ["observability"],
            "limit": limit,
        })
    )


@register_command("obs_timeline")
async def cmd_obs_timeline(params: dict) -> list:
    """Return timeline of observability events."""
    from stitch_backend.domains.logging.service import LoggingService
    from stitch_backend.database import run_in_session

    filter_ = params.get("filter", {})
    filter_.setdefault("channels", ["observability", "backend", "app"])
    return await run_in_session(
        lambda s: LoggingService(s).query_logs(filter_)
    )


# =============================================================================
# Proxy config (replaces stubs — backed by settings table)
# =============================================================================

@register_command("get_proxy_config")
async def cmd_get_proxy_config(params: dict) -> dict:
    """Return proxy configuration from settings."""
    from stitch_backend.database import run_in_session
    from sqlalchemy import text
    import json

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

    return await run_in_session(_op)


@register_command("save_proxy_config")
async def cmd_save_proxy_config(params: dict) -> None:
    """Persist proxy configuration to settings."""
    from stitch_backend.database import run_in_session
    from sqlalchemy import text
    import json

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


@register_command("get_proxy_settings")
async def cmd_get_proxy_settings(params: dict) -> dict:
    """Return AI proxy settings from settings table."""
    from stitch_backend.database import run_in_session
    from sqlalchemy import text
    import json

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

    return await run_in_session(_op)


@register_command("update_proxy_settings")
async def cmd_update_proxy_settings(params: dict) -> None:
    """Persist AI proxy settings to settings table."""
    from stitch_backend.database import run_in_session
    from sqlalchemy import text
    import json

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

@register_command("get_proxy_debug_logs")
async def cmd_get_proxy_debug_logs(params: dict) -> list:
    """Return proxy debug logs from app_logs table."""
    from stitch_backend.domains.logging.service import LoggingService
    from stitch_backend.database import run_in_session

    limit = int(params.get("limit", 100))
    result = await run_in_session(
        lambda s: LoggingService(s).query_logs({
            "channels": ["proxy"],
            "limit": limit,
        })
    )
    return result.get("logs", [])


@register_command("clear_proxy_debug_logs")
async def cmd_clear_proxy_debug_logs(params: dict) -> int:
    """Clear proxy debug logs from app_logs table."""
    from stitch_backend.domains.logging.service import LoggingService
    from stitch_backend.database import run_in_session

    return await run_in_session(
        lambda s: LoggingService(s).clear_logs()
    )


# =============================================================================
# Request history (replaces stubs — backed by app_logs table)
# =============================================================================

@register_command("get_request_history")
async def cmd_get_request_history(params: dict) -> dict:
    """Return AI proxy request history from app_logs."""
    from stitch_backend.domains.logging.service import LoggingService
    from stitch_backend.database import run_in_session

    limit = int(params.get("limit", 50))
    result = await run_in_session(
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
    from stitch_backend.domains.logging.service import LoggingService
    from stitch_backend.database import run_in_session

    await run_in_session(
        lambda s: LoggingService(s).clear_logs()
    )
