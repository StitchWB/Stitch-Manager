"""TOTP command handlers.

Commands:
    list_totp_keys   — list all stored TOTP keys (secrets masked)
    add_totp_key     — add a new TOTP secret key
    update_totp_key  — update label / issuer / account_id
    remove_totp_key  — delete a key by id
    link_totp_key    — link an existing key to an account id
    totp_share_group    — share a key to a group (owner-of-row + member)
    totp_unshare_group  — unshare (row owner OR group owner)
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import and_, delete, or_, select

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.auth.permissions import ensure_permission
from stitch_backend.domains.groups.models import Group
from stitch_backend.domains.groups.service import (
    get_group,
    group_ids_for_user,
    is_member,
)
from stitch_backend.domains.totp.models import TotpGroupShare, TotpKey

logger = logging.getLogger(__name__)


def _caller_uid(params: dict) -> int | None:
    """Extract the caller's user ID (None when auth disabled / guest)."""
    return params.get("_caller_user_id")


def _visible_filter(uid: int | None, group_ids: list[str]):
    """WHERE clause: own OR instance-shared(NULL) OR shared into caller's groups."""
    if not group_ids:
        return or_(TotpKey.owner_id.is_(None), TotpKey.owner_id == uid)
    return or_(
        TotpKey.owner_id.is_(None),
        TotpKey.owner_id == uid,
        TotpKey.id.in_(
            select(TotpGroupShare.totp_key_id).where(
                TotpGroupShare.group_id.in_(group_ids)
            )
        ),
    )


def _key_to_dict(
    key: TotpKey,
    *,
    include_secret: bool = False,
    uid: int | None = None,
    shared_group_names: list[str] | None = None,
) -> dict[str, Any]:
    """Serialize a TotpKey row to a camelCase-friendly dict.

    When ``uid`` is given, additive ``mine`` and ``shared`` fields are
    included: ``mine`` = key.owner_id == uid, ``shared`` = owner_id is None.
    ``sharedGroupNames`` mirrors the gateway CredentialResponse addition.
    """
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
        "ownerId": key.owner_id,
    }
    if include_secret:
        result["secret"] = key.secret
    if uid is not None:
        result["mine"] = key.owner_id == uid
        result["shared"] = key.owner_id is None
    result["sharedGroupNames"] = shared_group_names or []
    return result


# ═════════════════════════════════════════════════════════════════════════════
# list_totp_keys
# ═════════════════════════════════════════════════════════════════════════════

@register_command("list_totp_keys", readonly=True)
async def cmd_list_totp_keys(params: dict) -> list[dict]:
    """Return all TOTP keys visible to the caller (with secrets for frontend).

    Single LEFT JOIN to ``totp_group_shares`` + ``groups`` populates
    ``sharedGroupNames`` on each item — no N+1.
    """
    uid = _caller_uid(params)

    async def _op(session):
        group_ids = await group_ids_for_user(session, uid)
        stmt = (
            select(TotpKey, Group.name)
            .select_from(TotpKey)
            .outerjoin(
                TotpGroupShare,
                TotpGroupShare.totp_key_id == TotpKey.id,
            )
            .outerjoin(Group, Group.id == TotpGroupShare.group_id)
            .where(_visible_filter(uid, group_ids))
            .order_by(TotpKey.created_at)
        )
        result = await session.execute(stmt)

        # Aggregate: one entry per key, group names collected.
        key_map: dict[str, TotpKey] = {}
        group_names_map: dict[str, list[str]] = {}
        for key, gname in result.all():
            if key.id not in key_map:
                key_map[key.id] = key
                group_names_map[key.id] = []
            if gname is not None:
                group_names_map[key.id].append(gname)

        return [
            _key_to_dict(
                key_map[kid],
                include_secret=True,
                uid=uid,
                shared_group_names=group_names_map[kid],
            )
            for kid in key_map
        ]

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
        group_ids = await group_ids_for_user(session, uid)
        result = await session.execute(
            select(TotpKey).where(
                and_(TotpKey.id == str(key_id), _visible_filter(uid, group_ids))
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
        group_ids = await group_ids_for_user(session, uid)
        result = await session.execute(
            select(TotpKey).where(
                and_(TotpKey.id == str(key_id), _visible_filter(uid, group_ids))
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
    """Link a TOTP key to an account (or unlink if accountId is null).

    Caller must be owner OR member of a sharing group OR row instance-shared.
    """
    uid = _caller_uid(params)
    key_id = params.get("id") or params.get("keyId") or params.get("key_id")
    account_id = params.get("accountId") or params.get("account_id") or None

    if not key_id:
        raise ValueError("Key id is required")

    async def _op(session):
        group_ids = await group_ids_for_user(session, uid)
        result = await session.execute(
            select(TotpKey).where(
                and_(TotpKey.id == str(key_id), _visible_filter(uid, group_ids))
            )
        )
        key = result.scalar_one_or_none()
        if key is None:
            raise ValueError(f"TOTP key not found: {key_id}")
        key.account_id = str(account_id) if account_id else None
        await session.flush()
        return _key_to_dict(key, include_secret=True, uid=uid)

    return await run_in_session(_op)


# ── Claim ─────────────────────────────────────────────────────────────────────


@register_command("claim_totp_key")
async def cmd_claim_totp_key(params: dict) -> dict:
    """Claim a shared (owner_id NULL) TOTP key for the caller.

    Sets ``owner_id = caller uid`` ONLY when the current owner_id is
    NULL.  Caller must be authenticated (uid not None) else 400.
    """
    await ensure_permission(params, "action.claim")
    uid = _caller_uid(params)
    if uid is None:
        raise ValueError("Authentication required to claim a shared key")
    key_id = params.get("id") or params.get("keyId") or params.get("key_id")
    if not key_id:
        raise ValueError("Key id is required")

    async def _op(session):
        result = await session.execute(
            select(TotpKey).where(TotpKey.id == str(key_id))
        )
        key = result.scalar_one_or_none()
        if key is None:
            raise ValueError(f"TOTP key not found: {key_id}")
        if key.owner_id is not None:
            raise ValueError("not shared")
        key.owner_id = uid
        await session.flush()
        return _key_to_dict(key, include_secret=True, uid=uid)

    return await run_in_session(_op)


# ═════════════════════════════════════════════════════════════════════════════
# totp_share_group / totp_unshare_group
# ═════════════════════════════════════════════════════════════════════════════


@register_command("totp_share_group")
async def cmd_totp_share_group(params: dict) -> dict:
    """Share a TOTP key to a group (key owner + group member; idempotent)."""
    totp_id = params.get("totpId") or params.get("totp_id")
    group_id = params.get("groupId") or params.get("group_id")
    uid = _caller_uid(params)
    if not totp_id:
        raise StitchError("totpId is required")
    if not group_id:
        raise StitchError("groupId is required")

    async def _op(session):
        group = await get_group(session, group_id)
        if group is None:
            raise StitchError("Group not found")

        result = await session.execute(
            select(TotpKey).where(TotpKey.id == str(totp_id))
        )
        key = result.scalar_one_or_none()
        if key is None:
            raise StitchError("TOTP key not found")

        if uid is not None:
            if key.owner_id != uid:
                raise StitchError("Only the key owner can share it")
            if not await is_member(session, group_id, uid):
                raise StitchError("Not a member of this group")

        existing = await session.execute(
            select(TotpGroupShare).where(
                and_(
                    TotpGroupShare.totp_key_id == str(totp_id),
                    TotpGroupShare.group_id == group_id,
                )
            )
        )
        if existing.scalar_one_or_none() is not None:
            return True

        share = TotpGroupShare(
            totp_key_id=str(totp_id),
            group_id=group_id,
        )
        session.add(share)
        await session.flush()
        return True

    await run_in_session(_op)
    return {"success": True}


@register_command("totp_unshare_group")
async def cmd_totp_unshare_group(params: dict) -> dict:
    """Unshare a TOTP key (key owner OR group owner; idempotent)."""
    totp_id = params.get("totpId") or params.get("totp_id")
    group_id = params.get("groupId") or params.get("group_id")
    uid = _caller_uid(params)
    if not totp_id:
        raise StitchError("totpId is required")
    if not group_id:
        raise StitchError("groupId is required")

    async def _op(session):
        group = await get_group(session, group_id)
        if group is None:
            raise StitchError("Group not found")

        result = await session.execute(
            select(TotpKey).where(TotpKey.id == str(totp_id))
        )
        key = result.scalar_one_or_none()
        if key is None:
            raise StitchError("TOTP key not found")

        if uid is not None:
            is_key_owner = key.owner_id == uid
            is_group_owner = group.owner_id == uid
            if not (is_key_owner or is_group_owner):
                raise StitchError(
                    "Only the key owner or group owner can unshare"
                )

        await session.execute(
            delete(TotpGroupShare).where(
                and_(
                    TotpGroupShare.totp_key_id == str(totp_id),
                    TotpGroupShare.group_id == group_id,
                )
            )
        )
        await session.flush()
        return True

    await run_in_session(_op)
    return {"success": True}
