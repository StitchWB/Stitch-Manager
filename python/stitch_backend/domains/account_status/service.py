"""Account Status service — status checks + profile session management.

Ported from Rust ``commands/account/active.rs``.
- ``check_account_status`` dispatches to provider-specific quota checkers.
- ``check_windsurf_balance`` calls the Windsurf API directly.
- Profile session commands manage tags + browser session data.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from autoreg.providers.base import ProviderId

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT = 15.0


def _now_rfc3339() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def _now_sqlite() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _is_token_expired(expires_at: str | None) -> bool:
    if not expires_at:
        return True
    try:
        exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        return datetime.now(timezone.utc) >= exp
    except (ValueError, TypeError):
        return True


def _status_info(
    provider: str, email: str, is_active: bool, plan: str,
    quota_used: int = 0, quota_limit: int = -1,
    expires_at: str | None = None, raw: str | None = None,
) -> dict[str, Any]:
    pct = (quota_used / quota_limit * 100) if quota_limit > 0 else 0.0
    return {
        "provider": provider,
        "email": email,
        "isActive": is_active,
        "plan": plan,
        "quotaUsed": quota_used,
        "quotaLimit": quota_limit,
        "quotaPercent": pct,
        "flowCreditsUsed": None,
        "flowCreditsLimit": None,
        "expiresAt": expires_at,
        "resetsAt": None,
        "rawResponse": raw,
    }


# ── check_account_status ─────────────────────────────────────────────────────

async def check_account_status(db: AsyncSession, account_id: int) -> dict[str, Any]:
    """Check account status — dispatches to provider-specific handlers."""
    account = await _get_account(db, account_id)
    if not account:
        raise RuntimeError(f"Account {account_id} not found")

    provider = account.get("provider", "")
    email = account.get("email", "")
    token = account.get("token")
    expires_at = account.get("expires_at")

    # Token expired?
    if _is_token_expired(expires_at):
        # For now, return expired status (token refresh requires OAuth logic)
        logger.warning("Token for account %d (%s) is expired", account_id, email)
        return _status_info(
            provider, email, False, "Expired",
            expires_at=expires_at,
            raw="Token expired. Please re-authenticate.",
        )

    # Provider dispatch — use ProviderId enum for exhaustive, typo-proof matching
    _pid = provider  # keep original string for _status_info calls

    if provider in (ProviderId.AWS.value, ProviderId.AWS_BUILDER_ID.value):
        return _status_info(
            _pid, email, account.get("status") == "active",
            "AWS Builder ID", expires_at=expires_at,
            raw="AWS Builder ID account - used for OAuth authorization",
        )

    if provider == ProviderId.GITHUB.value:
        is_active = bool(token) and not _is_token_expired(expires_at)
        return _status_info(
            _pid, email, is_active, "GitHub Account",
            expires_at=expires_at,
            raw="GitHub account - used for OAuth authorization",
        )

    if provider == ProviderId.TRAE.value:
        is_active = bool(token) and not _is_token_expired(expires_at)
        return _status_info(
            _pid, email, is_active, "Trae Account",
            expires_at=expires_at,
            raw="Trae quota check not yet implemented",
        )

    if provider == ProviderId.WINDSURF.value:
        if not token:
            raise RuntimeError("No token found for Windsurf account")
        metadata = account.get("metadata")
        installation_id = "unknown"
        if metadata:
            try:
                meta_json = json.loads(metadata)
                installation_id = meta_json.get("installationId", "unknown")
            except (json.JSONDecodeError, TypeError):
                pass
        status = await _check_windsurf_quota(token, installation_id)
        # Update DB
        status_str = "active" if status["isActive"] else "expired"
        if "Banned" in status.get("plan", ""):
            status_str = "banned"
        await _update_account_status(db, account_id, status_str, status.get("quotaUsed", 0))
        return status

    if provider in (ProviderId.KIRO.value, ProviderId.KIRO_V2.value):
        if not token:
            raise RuntimeError("No token found for Kiro account")
        # Kiro quota check via CodeWhisperer API
        quota = await _check_kiro_quota(token)
        if quota.get("error"):
            return _status_info(
                _pid, email, False, "Error",
                expires_at=expires_at, raw=quota["error"],
            )
        used = quota.get("used", 0)
        limit = quota.get("limit", 0)
        await _update_account_status(db, account_id, "active", used)
        return _status_info(
            _pid, email, True, "Pro",
            quota_used=used, quota_limit=limit,
            expires_at=expires_at,
        )

    raise RuntimeError(f"Status check not supported for provider: {provider!r}")


# ── check_windsurf_balance ────────────────────────────────────────────────────

async def check_windsurf_balance(api_key: str) -> dict[str, Any]:
    """Check Windsurf account balance using API key."""
    if not api_key.strip():
        raise ValueError("API key is required")
    import uuid
    installation_id = str(uuid.uuid4())
    return await _check_windsurf_quota(api_key, installation_id)


# ── Profile session commands ──────────────────────────────────────────────────

async def open_account_profile_session(db: AsyncSession, account_id: int) -> None:
    """Open a manual profile session for an account."""
    account = await _get_account(db, account_id)
    if not account:
        raise RuntimeError(f"Account {account_id} not found")

    tags = _parse_tags(account.get("tags"))
    _tag_add_unique(tags, "profile:manual")
    _tag_add_unique(tags, "profile:pending")
    tags[:] = [t for t in tags if t != "profile:ready"]
    await _update_account_tags(db, account_id, tags)

    # Save basic session data
    now = _now_rfc3339()
    session_data = json.dumps({
        "profileProvider": "persistent-browser",
        "state": "login_in_progress",
        "openedAt": now,
        "accountId": account_id,
        "provider": account.get("provider", ""),
    })
    await _save_browser_session(db, account_id, "", "{}", session_data)
    logger.info("Profile session opened for account %d", account_id)


async def confirm_account_profile_session(db: AsyncSession, account_id: int) -> None:
    """Confirm manual login for a profile session."""
    account = await _get_account(db, account_id)
    if not account:
        raise RuntimeError(f"Account {account_id} not found")

    tags = _parse_tags(account.get("tags"))
    _tag_add_unique(tags, "profile:manual")
    tags[:] = [t for t in tags if t != "profile:pending"]
    _tag_add_unique(tags, "profile:ready")
    await _update_account_tags(db, account_id, tags)

    # Update session state
    now = _now_rfc3339()
    session_raw = account.get("session_data") or "{}"
    try:
        session_json = json.loads(session_raw)
    except (json.JSONDecodeError, TypeError):
        session_json = {}
    session_json["state"] = "ready"
    session_json["lastLoginAt"] = now
    session_data = json.dumps(session_json)

    profile_path = account.get("browser_profile_path", "")
    cookies = account.get("cookies", "{}")
    await _save_browser_session(db, account_id, profile_path, cookies, session_data)
    logger.info("Profile session confirmed for account %d", account_id)


async def clear_account_profile_session(db: AsyncSession, account_id: int) -> None:
    """Clear profile session data and tags for an account."""
    account = await _get_account(db, account_id)
    if not account:
        raise RuntimeError(f"Account {account_id} not found")

    tags = _parse_tags(account.get("tags"))
    tags[:] = [t for t in tags if not t.startswith("profile:")]
    await _update_account_tags(db, account_id, tags)

    now = _now_sqlite()
    await db.execute(
        text("UPDATE accounts SET browser_profile_path='', cookies='', session_data='', updated_at=:now WHERE id=:id"),
        {"now": now, "id": account_id},
    )
    await db.flush()
    logger.info("Profile session cleared for account %d", account_id)


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _get_account(db: AsyncSession, account_id: int) -> dict[str, Any] | None:
    result = await db.execute(
        text("SELECT * FROM accounts WHERE id = :id"), {"id": account_id},
    )
    row = result.fetchone()
    if not row:
        return None
    return dict(row._mapping)


async def _update_account_status(
    db: AsyncSession, account_id: int, status: str, quota_used: int = 0,
) -> None:
    now = _now_sqlite()
    await db.execute(
        text("UPDATE accounts SET status=:s, quota_used=:q, updated_at=:now WHERE id=:id"),
        {"s": status, "q": quota_used, "now": now, "id": account_id},
    )
    await db.flush()


async def _update_account_tags(db: AsyncSession, account_id: int, tags: list[str]) -> None:
    now = _now_sqlite()
    await db.execute(
        text("UPDATE accounts SET tags=:tags, updated_at=:now WHERE id=:id"),
        {"tags": json.dumps(tags), "now": now, "id": account_id},
    )
    await db.flush()


async def _save_browser_session(
    db: AsyncSession, account_id: int, profile_path: str, cookies: str, session_data: str,
) -> None:
    now = _now_sqlite()
    await db.execute(
        text(
            "UPDATE accounts SET browser_profile_path=:pp, cookies=:c, "
            "session_data=:sd, updated_at=:now WHERE id=:id"
        ),
        {"pp": profile_path, "c": cookies, "sd": session_data, "now": now, "id": account_id},
    )
    await db.flush()


def _parse_tags(tags_raw: str | None) -> list[str]:
    if not tags_raw or not tags_raw.strip():
        return []
    try:
        parsed = json.loads(tags_raw)
        if isinstance(parsed, list):
            return [str(t) for t in parsed if isinstance(t, str)]
    except (json.JSONDecodeError, TypeError):
        pass
    return []


def _tag_add_unique(tags: list[str], tag: str) -> None:
    if tag not in tags:
        tags.append(tag)


# ── External API calls ────────────────────────────────────────────────────────

def _safe_int(val: Any, default: int = 0) -> int:
    """Safely convert a value to int, matching Rust's `.unwrap_or(0)`."""
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


async def _check_windsurf_quota(api_key: str, installation_id: str) -> dict[str, Any]:
    """Check Windsurf (Codeium) quota via GetUserStatus gRPC-web endpoint.

    Matches Rust ``account_status_service.rs`` → ``check_windsurf_status``.
    """
    url = (
        "https://server.codeium.com"
        "/exa.seat_management_pb.SeatManagementService/GetUserStatus"
    )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {"metadata": {"installationId": installation_id}}

    try:
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
        proxy_url = _get_outbound_proxy()
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, proxy=proxy_url) as client:
            resp = await client.post(url, json=body, headers=headers)
            if resp.status_code >= 400:
                return _status_info(
                    "windsurf", "", False, "Error",
                    raw=f"Codeium API returned {resp.status_code}",
                )
            data = resp.json()
    except httpx.TimeoutException:
        return _status_info("windsurf", "", False, "Error", raw="Codeium API timeout")
    except Exception as exc:
        return _status_info("windsurf", "", False, "Error", raw=str(exc))

    # Parse nested Codeium response: userStatus / planStatus
    user_status = data.get("userStatus", data)
    plan_status = data.get("planStatus", data)

    email = user_status.get("email", "")
    is_active = user_status.get("isActive", False)
    used = _safe_int(plan_status.get("usedPromptCredits", plan_status.get("usage", 0)))
    limit = _safe_int(plan_status.get("availablePromptCredits", plan_status.get("limit", 500)))
    banned = user_status.get("banned", False) or user_status.get("suspended", False)

    plan = "Pro" if is_active else "Free"
    if banned:
        plan = "Banned"
        is_active = False

    return _status_info(
        "windsurf", email, is_active, plan,
        quota_used=used, quota_limit=limit,
        raw=json.dumps(data, ensure_ascii=False)[:500],
    )


async def _check_kiro_quota(token: str) -> dict[str, Any]:
    """Check Kiro quota via CodeWhisperer API."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    try:
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
        proxy_url = _get_outbound_proxy()
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT, proxy=proxy_url) as client:
            resp = await client.get(
                "https://api.us-east-1.codewhisperer.amazonaws.com/quota",
                headers=headers,
            )
            if resp.status_code == 403:
                return {"error": "BANNED - Account suspended (403)"}
            if resp.status_code == 401:
                return {"error": "UNAUTHORIZED - Token expired"}
            if resp.status_code >= 400:
                return {"error": f"CodeWhisperer API returned {resp.status_code}"}
            data = resp.json()
    except httpx.TimeoutException:
        return {"error": "CodeWhisperer API timeout"}
    except Exception as exc:
        return {"error": str(exc)}

    used = _safe_int(data.get("used", 0))
    limit = _safe_int(data.get("limit", data.get("totalQuota", 0)))
    return {"used": used, "limit": limit}
