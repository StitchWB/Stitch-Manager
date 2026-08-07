"""
iCloud Hide My Email pool — command handlers.

Commands:
  icloud_pool_get_stats         → pool statistics
  icloud_pool_list_entries      → paginated list of pool entries
  icloud_pool_fill              → generate N new aliases (≤5)
  icloud_pool_release_entry     → mark entry used/failed after registration
  icloud_pool_delete_entry      → delete alias on Apple + mark as deleted
  icloud_pool_authenticate      → trigger iCloud auth (with optional 2FA)
  icloud_pool_configure         → update Apple ID / password in settings + service
"""

from __future__ import annotations

import logging

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.icloud_email_pool.schemas import (
    AuthenticateICloudRequest,
    DeletePoolEntryRequest,
    FillPoolRequest,
    ReleasePoolEntryRequest,
)
from stitch_backend.domains.icloud_email_pool.service import get_icloud_pool_service

logger = logging.getLogger(__name__)


def _entry_to_dict(entry) -> dict:
    """Serialize ORM entry to camelCase dict."""
    return {
        "id": entry.id,
        "email": entry.email,
        "appleAliasId": entry.apple_alias_id,
        "label": entry.label,
        "status": entry.status,
        "appleId": entry.apple_id,
        "usedByAccountId": entry.used_by_account_id,
        "createdAt": entry.created_at.isoformat() if entry.created_at else None,
        "reservedAt": entry.reserved_at.isoformat() if entry.reserved_at else None,
        "usedAt": entry.used_at.isoformat() if entry.used_at else None,
    }


# ── Stats ─────────────────────────────────────────────────────────────────────

@register_command("icloud_pool_get_stats", readonly=True)
async def cmd_get_stats(params: dict) -> dict:
    """Return pool statistics (counts by status + rate limit info)."""
    svc = get_icloud_pool_service()

    async def _op(session):
        stats = await svc.get_stats(session)
        return stats.model_dump(by_alias=True)

    return await run_in_read_session(_op)


# ── List entries ──────────────────────────────────────────────────────────────

@register_command("icloud_pool_list_entries", readonly=True)
async def cmd_list_entries(params: dict) -> list:
    """List pool entries with optional status filter and pagination."""
    status = params.get("status")
    limit = int(params.get("limit", 100))
    offset = int(params.get("offset", 0))
    svc = get_icloud_pool_service()

    async def _op(session):
        entries = await svc.list_entries(session, status=status, limit=limit, offset=offset)
        return [_entry_to_dict(e) for e in entries]

    return await run_in_read_session(_op)


# ── Fill pool ─────────────────────────────────────────────────────────────────

@register_command("icloud_pool_fill")
async def cmd_fill_pool(params: dict) -> dict:
    """
    Generate up to N new Hide My Email aliases and add them to the pool.

    Apple allows ~5 aliases per 30 minutes — ``count`` is capped at 5.
    """
    req = FillPoolRequest.model_validate(params)
    svc = get_icloud_pool_service()

    async def _op(session):
        entries = await svc.fill_pool(session, count=req.count, label_prefix=req.label_prefix)
        return {
            "created": len(entries),
            "entries": [_entry_to_dict(e) for e in entries],
        }

    return await run_in_session(_op)


# ── Release entry ─────────────────────────────────────────────────────────────

@register_command("icloud_pool_release_entry")
async def cmd_release_entry(params: dict) -> dict:
    """Mark a reserved pool entry as used (success=true) or failed (success=false)."""
    req = ReleasePoolEntryRequest.model_validate(params)
    svc = get_icloud_pool_service()

    async def _op(session):
        await svc.release_entry(
            session,
            entry_id=req.entry_id,
            success=req.success,
            account_id=req.account_id,
        )
        return {"ok": True}

    return await run_in_session(_op)


# ── Delete entry ──────────────────────────────────────────────────────────────

@register_command("icloud_pool_delete_entry")
async def cmd_delete_entry(params: dict) -> dict:
    """Deactivate alias on Apple's side and mark the pool entry as deleted."""
    req = DeletePoolEntryRequest.model_validate(params)
    svc = get_icloud_pool_service()

    async def _op(session):
        await svc.delete_entry(session, entry_id=req.entry_id)
        return {"ok": True}

    return await run_in_session(_op)


# ── Authenticate ──────────────────────────────────────────────────────────────

@register_command("icloud_pool_authenticate")
async def cmd_authenticate(params: dict) -> dict:
    """
    Authenticate the iCloud service (or complete 2FA).

    Flow:
      1. First call (no verificationCode) → triggers Apple auth.
         Returns {"status": "ok"} or {"status": "2fa_required", "message": "..."}.
      2. If 2FA needed, call again with {"verificationCode": "123456"}.
    """
    req = AuthenticateICloudRequest.model_validate(params)
    svc = get_icloud_pool_service()
    return svc.authenticate(verification_code=req.verification_code)


# ── Configure ─────────────────────────────────────────────────────────────────

@register_command("icloud_pool_configure")
async def cmd_configure(params: dict) -> dict:
    """
    Update Apple ID / app-specific password and re-configure the service.

    Also persists to settings so the config survives restarts.
    """
    apple_id: str = params.get("appleId", params.get("apple_id", ""))
    app_password: str = params.get("appPassword", params.get("app_password", ""))
    cookie_dir: str = params.get("cookieDirectory", params.get("cookie_directory", ""))

    if not apple_id or not app_password:
        raise ValueError("appleId and appPassword are required")

    # Persist to settings DB
    async def _save(session):
        from stitch_backend.domains.settings.service import SettingsService
        svc = SettingsService(session)
        await svc.update({
            "icloudEnabled": True,
            "icloudAppleId": apple_id,
            "icloudAppPassword": app_password,
        })

    await run_in_session(_save)

    # (Re-)configure the service
    svc = get_icloud_pool_service()
    svc.configure(apple_id=apple_id, app_password=app_password, cookie_dir=cookie_dir)

    return {"ok": True, "message": f"Configured iCloud for {apple_id}. Call icloud_pool_authenticate next."}
