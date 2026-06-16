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
