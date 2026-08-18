"""TOTP command handlers.

Commands:
    list_totp_keys   — list all stored TOTP keys (secrets masked)
    add_totp_key     — add a new TOTP secret key
    update_totp_key  — update label / issuer / account_id
    remove_totp_key  — delete a key by id
    link_totp_key    — link an existing key to an account id
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import and_, or_, select

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.totp.models import TotpKey

logger = logging.getLogger(__name__)


def _caller_uid(params: dict) -> int | None:
    """Extract the caller's user ID (None when auth disabled / guest)."""
    return params.get("_caller_user_id")


def _owner_filter(uid: int | None):
    """WHERE clause: owner_id IS NULL OR owner_id = uid."""
    return or_(TotpKey.owner_id.is_(None), TotpKey.owner_id == uid)


def _key_to_dict(key: TotpKey, *, include_secret: bool = False) -> dict[str, Any]:
    """Serialize a TotpKey row to a camelCase-friendly dict."""
    result: dict[str, Any] = {
        "id": key.id,
        "label": key.label,
        "issuer": key.issuer,
        "accountId": key.account_id,
        "digits": key.digits,
        "period": key.period,
        "algorithm": key.algorithm,
        "enabled": key.enabled,
        "createdAt": key.created_at.isoformat() if key.created_at else None,
    }
    if include_secret:
        result["secret"] = key.secret
    return result


# ═════════════════════════════════════════════════════════════════════════════
# list_totp_keys
# ═════════════════════════════════════════════════════════════════════════════

@register_command("list_totp_keys", readonly=True)
async def cmd_list_totp_keys(params: dict) -> list[dict]:
    """Return all TOTP keys visible to the caller (with secrets for frontend)."""
    uid = _caller_uid(params)

    async def _op(session):
        result = await session.execute(
            select(TotpKey).where(_owner_filter(uid)).order_by(TotpKey.created_at)
        )
        keys = result.scalars().all()
        return [_key_to_dict(k, include_secret=True) for k in keys]

    return await run_in_read_session(_op)


# ═════════════════════════════════════════════════════════════════════════════
# add_totp_key
# ═════════════════════════════════════════════════════════════════════════════

@register_command("add_totp_key")
async def cmd_add_totp_key(params: dict) -> dict:
    """Add a new TOTP key. Returns the created key (with secret)."""
    uid = _caller_uid(params)
    label = params.get("label") or params.get("Label") or "Unnamed"
    secret = (params.get("secret") or params.get("Secret") or "").strip().upper()
    issuer = params.get("issuer") or params.get("Issuer") or None
    account_id = params.get("accountId") or params.get("account_id") or None
    digits = int(params.get("digits", 6))
    period = int(params.get("period", 30))
    algorithm = (params.get("algorithm") or "SHA1").upper()

    if not secret:
        raise ValueError("TOTP secret is required")
    if not label:
        raise ValueError("Label is required")

    async def _op(session):
        key = TotpKey(
            id=str(uuid.uuid4()),
            owner_id=uid,
            label=label,
            secret=secret,
            issuer=issuer,
            account_id=account_id,
            digits=digits,
            period=period,
            algorithm=algorithm,
            enabled=True,
        )
        session.add(key)
        await session.flush()
        return _key_to_dict(key, include_secret=True)

    return await run_in_session(_op)


# ═════════════════════════════════════════════════════════════════════════════
# update_totp_key
# ═════════════════════════════════════════════════════════════════════════════

@register_command("update_totp_key")
async def cmd_update_totp_key(params: dict) -> dict:
    """Update label, issuer, or account_id for an existing key."""
    uid = _caller_uid(params)
    key_id = params.get("id") or params.get("keyId") or params.get("key_id")
    if not key_id:
        raise ValueError("Key id is required")

    async def _op(session):
        result = await session.execute(
            select(TotpKey).where(
                and_(TotpKey.id == str(key_id), _owner_filter(uid))
            )
        )
        key = result.scalar_one_or_none()
        if key is None:
            raise ValueError(f"TOTP key not found: {key_id}")

        if "label" in params:
            key.label = params["label"]
        if "issuer" in params:
            key.issuer = params["issuer"] or None
        if "accountId" in params:
            key.account_id = params["accountId"] or None
        if "account_id" in params:
            key.account_id = params["account_id"] or None
        if "enabled" in params:
            key.enabled = bool(params["enabled"])

        await session.flush()
        return _key_to_dict(key, include_secret=True)

    return await run_in_session(_op)


# ═════════════════════════════════════════════════════════════════════════════
# remove_totp_key
# ═════════════════════════════════════════════════════════════════════════════

@register_command("remove_totp_key")
async def cmd_remove_totp_key(params: dict) -> dict:
    """Delete a TOTP key by id."""
    uid = _caller_uid(params)
    key_id = params.get("id") or params.get("keyId") or params.get("key_id")
    if not key_id:
        raise ValueError("Key id is required")

    async def _op(session):
        result = await session.execute(
            select(TotpKey).where(
                and_(TotpKey.id == str(key_id), _owner_filter(uid))
            )
        )
        key = result.scalar_one_or_none()
        if key is None:
            raise ValueError(f"TOTP key not found: {key_id}")
        await session.delete(key)

    await run_in_session(_op)
    return {"success": True, "id": str(key_id)}


# ═════════════════════════════════════════════════════════════════════════════
# link_totp_key  — attach an existing TOTP key to an account
# ═════════════════════════════════════════════════════════════════════════════

@register_command("link_totp_key")
async def cmd_link_totp_key(params: dict) -> dict:
    """Link a TOTP key to an account (or unlink if accountId is null)."""
    uid = _caller_uid(params)
    key_id = params.get("id") or params.get("keyId") or params.get("key_id")
    account_id = params.get("accountId") or params.get("account_id") or None

    if not key_id:
        raise ValueError("Key id is required")

    async def _op(session):
        result = await session.execute(
            select(TotpKey).where(
                and_(TotpKey.id == str(key_id), _owner_filter(uid))
            )
        )
        key = result.scalar_one_or_none()
        if key is None:
            raise ValueError(f"TOTP key not found: {key_id}")
        key.account_id = str(account_id) if account_id else None
        await session.flush()
        return _key_to_dict(key, include_secret=True)

    return await run_in_session(_op)
