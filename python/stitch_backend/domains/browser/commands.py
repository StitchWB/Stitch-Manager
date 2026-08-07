"""Browser domain command handlers.

Exposes browser session management (open, save, load, clear) and
account browser launching to the frontend.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC
from typing import Any

from sqlalchemy import text

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session

logger = logging.getLogger(__name__)


# ── DB helpers (raw SQL, matching Rust browser_session.rs) ─────────────────

async def _save_session(db, account_id: int, profile_path: str, cookies: str, session_data: str) -> None:
    """Persist browser session data for an account."""
    from datetime import datetime

    # Validate JSON fields (empty strings are allowed)
    if cookies:
        json.loads(cookies)
    if session_data:
        json.loads(session_data)

    now = datetime.now(UTC).isoformat()
    await db.execute(
        text(
            "UPDATE accounts "
            "SET browser_profile_path = :pp, cookies = :ck, session_data = :sd, updated_at = :now "
            "WHERE id = :id"
        ),
        {"pp": profile_path, "ck": cookies, "sd": session_data, "now": now, "id": account_id},
    )


async def _load_session(db, account_id: int) -> dict[str, str] | None:
    """Load browser session data for an account."""
    row = (
        await db.execute(
            text("SELECT browser_profile_path, cookies, session_data FROM accounts WHERE id = :id"),
            {"id": account_id},
        )
    ).mappings().first()

    if not row:
        return None
    pp = row.get("browser_profile_path")
    if not pp:
        return None
    return {
        "profilePath": pp,
        "cookies": row.get("cookies") or "",
        "sessionData": row.get("session_data") or "",
    }


async def _clear_session(db, account_id: int) -> None:
    """Clear browser session data for an account."""
    from datetime import datetime

    now = datetime.now(UTC).isoformat()
    await db.execute(
        text(
            "UPDATE accounts "
            "SET browser_profile_path = NULL, cookies = NULL, session_data = NULL, updated_at = :now "
            "WHERE id = :id"
        ),
        {"now": now, "id": account_id},
    )


async def _get_account_info(db, account_id: int) -> dict[str, Any] | None:
    """Load minimal account info needed for browser launch."""
    row = (
        await db.execute(
            text("SELECT id, email, provider, status FROM accounts WHERE id = :id"),
            {"id": account_id},
        )
    ).mappings().first()
    if not row:
        return None
    return {
        "id": row["id"],
        "email": row.get("email") or "",
        "provider": row.get("provider") or "",
        "status": row.get("status") or "",
    }


# ── Commands ───────────────────────────────────────────────────────────────


@register_command("save_browser_session")
async def cmd_save_browser_session(params: dict) -> dict:
    """Save browser session data (profile path, cookies, session data) for an account."""
    account_id = int(params.get("accountId", params.get("account_id", 0)))
    if not account_id:
        return {"success": False, "error": "No accountId specified"}

    profile_path = params.get("profilePath", params.get("profile_path", ""))
    cookies = params.get("cookies", "")
    session_data = params.get("sessionData", params.get("session_data", ""))

    try:
        await run_in_session(
            lambda db: _save_session(db, account_id, profile_path, cookies, session_data)
        )
    except json.JSONDecodeError as exc:
        return {"success": False, "error": f"Invalid JSON: {exc}"}
    except Exception as exc:
        logger.exception("Failed to save browser session")
        return {"success": False, "error": str(exc)}

    return {"success": True}


@register_command("load_browser_session", readonly=True)
async def cmd_load_browser_session(params: dict) -> dict | None:
    """Load saved browser session data for an account."""
    account_id = int(params.get("accountId", params.get("account_id", 0)))
    if not account_id:
        return None

    result: dict[str, str] | None = await run_in_read_session(lambda db: _load_session(db, account_id))
    return result


@register_command("clear_browser_session")
async def cmd_clear_browser_session(params: dict) -> dict:
    """Clear saved browser session data for an account."""
    account_id = int(params.get("accountId", params.get("account_id", 0)))
    if not account_id:
        return {"success": False, "error": "No accountId specified"}

    try:
        await run_in_session(lambda db: _clear_session(db, account_id))
    except Exception as exc:
        logger.exception("Failed to clear browser session")
        return {"success": False, "error": str(exc)}

    return {"success": True}


@register_command("open_account_browser", readonly=True)
async def cmd_open_account_browser(params: dict) -> dict:
    """Launch CloakBrowser/Chrome with the account's persistent profile.

    Loads saved session data from DB, launches the browser, and optionally
    injects cookies into the new session.
    """
    account_id = int(params.get("accountId", params.get("id", params.get("account_id", 0))))
    if not account_id:
        return {"success": False, "error": "No accountId specified"}

    # Load account + session from DB
    info = await run_in_read_session(lambda db: _get_account_info(db, account_id))
    if not info:
        return {"success": False, "error": f"Account {account_id} not found"}

    session = await run_in_read_session(lambda db: _load_session(db, account_id))
    profile_path = session["profilePath"] if session else None
    cookies = session["cookies"] if session else None

    provider = info.get("provider", "")
    email = info.get("email", "")
    proxy_url = params.get("proxyUrl", params.get("proxy"))
    headless = params.get("headless", False)
    extra_url = params.get("url")

    from stitch_backend.domains.browser.session import launch_account_browser

    result = await launch_account_browser(
        account_id=account_id,
        provider=provider,
        email=email,
        profile_path=profile_path,
        cookies_json=cookies,
        proxy_url=proxy_url,
        headless=headless,
        extra_url=extra_url,
    )

    return {
        "success": result.success,
        "profilePath": result.profile_path,
        "pid": result.pid,
        "url": result.url,
        "error": result.error,
    }
