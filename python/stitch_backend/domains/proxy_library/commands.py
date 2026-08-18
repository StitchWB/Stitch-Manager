"""Proxy library command handlers.

Exposes CRUD, bulk import, proxy testing, and runtime URL resolution
to the frontend via the command registry.

Per-owner semantics: reads see ``owner_id IS NULL OR owner_id = uid``;
writes set ``owner_id = uid`` on create and filter update/delete by
``owner_id = uid OR owner_id IS NULL`` (legacy shared pool editable by anyone).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from sqlalchemy import and_, or_, select

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.auth.permissions import ensure_permission
from stitch_backend.domains.proxy_library.models import ProxyLibraryEntry
from stitch_backend.domains.proxy_library.service import (
    ProxyLibraryDraft,
    ProxyLibraryImportResult,
    _keyring_account,
    _keyring_delete,
    _load_secret,
    _now_iso,
    _stable_key,
    _draft_stable_key,
    _store_secret,
    apply_update,
    draft_to_proxy_url,
    entry_from_draft,
    entry_to_proxy_url,
    import_lines,
    load_proxy_library,
    parse_proxy_line,
)

logger = logging.getLogger(__name__)


def _caller_uid(params: dict) -> int | None:
    """Extract the caller's user ID (None when auth disabled / guest)."""
    return params.get("_caller_user_id")


def _draft_from_dict(d: dict[str, Any]) -> ProxyLibraryDraft:
    """Build a ProxyLibraryDraft from a camelCase dict."""
    return ProxyLibraryDraft(
        host=str(d.get("host", "")).strip(),
        port=int(d.get("port", 0)),
        proxy_type=str(d.get("proxyType", d.get("proxy_type", "http"))),
        label=d.get("label"),
        username=d.get("username"),
        password=d.get("password"),
        enabled=bool(d.get("enabled", True)),
        notes=d.get("notes"),
    )


def _entry_to_response(entry: ProxyLibraryEntry, uid: int | None = None) -> dict[str, Any]:
    """Serialize an ORM entry to a camelCase dict for the frontend.

    When ``uid`` is given, additive ``mine`` and ``shared`` fields are
    included: ``mine`` = entry.owner_id == uid, ``shared`` = owner_id is None.
    """
    username = _load_secret(entry.username) if entry.username else None
    password = _load_secret(entry.password) if entry.password else None
    result: dict[str, Any] = {
        "id": entry.id,
        "label": entry.label,
        "host": entry.host,
        "port": entry.port,
        "proxyType": entry.proxy_type,
        "enabled": entry.enabled,
        "createdAt": entry.created_at,
        "updatedAt": entry.updated_at,
    }
    if username is not None:
        result["username"] = username
    if password is not None:
        result["password"] = password
    if entry.notes is not None:
        result["notes"] = entry.notes
    if entry.last_test_at is not None:
        result["lastTestAt"] = entry.last_test_at
    if entry.last_test_ok is not None:
        result["lastTestOk"] = entry.last_test_ok
    if entry.last_test_latency_ms is not None:
        result["lastTestLatencyMs"] = entry.last_test_latency_ms
    if entry.last_test_error is not None:
        result["lastTestError"] = entry.last_test_error
    if entry.last_test_ip is not None:
        result["lastTestIp"] = entry.last_test_ip
    if entry.last_test_location is not None:
        result["lastTestLocation"] = entry.last_test_location
    if uid is not None:
        result["mine"] = entry.owner_id == uid
        result["shared"] = entry.owner_id is None
    return result


def _import_result_to_response(r: ProxyLibraryImportResult) -> dict[str, Any]:
    return {
        "totalLines": r.total_lines,
        "imported": r.imported,
        "skipped": r.skipped,
        "issues": [
            {"lineNo": i.line_no, "linePreview": i.line_preview, "reason": i.reason}
            for i in r.issues
        ],
        "items": [_entry_to_response(e) for e in r.items],
    }


def _owner_filter(uid: int | None):
    """WHERE clause: owner_id IS NULL OR owner_id = uid."""
    return or_(ProxyLibraryEntry.owner_id.is_(None), ProxyLibraryEntry.owner_id == uid)


# ── CRUD ──────────────────────────────────────────────────────────────────────


@register_command("list_proxy_library", readonly=True)
async def cmd_list_proxy_library(params: dict) -> list[dict]:
    """List all proxy library entries visible to the caller."""
    uid = _caller_uid(params)

    async def _op(db):
        items = await load_proxy_library(db, uid)
        return [_entry_to_response(e, uid=uid) for e in items]

    return await run_in_read_session(_op)


@register_command("create_proxy_library_entry")
async def cmd_create_proxy_library_entry(params: dict) -> dict:
    """Create a new proxy library entry from a draft."""
    uid = _caller_uid(params)
    draft = _draft_from_dict(params.get("draft", params))

    async def _op(db):
        entry = entry_from_draft(draft)
        entry.owner_id = uid
        response = _entry_to_response(entry)  # capture plaintext before encrypt
        entry.username = _store_secret(entry.id, "username", entry.username)
        entry.password = _store_secret(entry.id, "password", entry.password)
        db.add(entry)
        await db.flush()
        return response

    return await run_in_session(_op)


@register_command("create_or_get_proxy_library_entry")
async def cmd_create_or_get(params: dict) -> dict:
    """Create entry or return existing one with same stable key."""
    uid = _caller_uid(params)
    draft = _draft_from_dict(params.get("draft", params))

    async def _op(db):
        items = await load_proxy_library(db, uid)
        target_key = _draft_stable_key(draft)
        for existing in items:
            if _stable_key(existing) == target_key:
                return _entry_to_response(existing)
        entry = entry_from_draft(draft)
        entry.owner_id = uid
        response = _entry_to_response(entry)
        entry.username = _store_secret(entry.id, "username", entry.username)
        entry.password = _store_secret(entry.id, "password", entry.password)
        db.add(entry)
        await db.flush()
        return response

    return await run_in_session(_op)


@register_command("update_proxy_library_entry")
async def cmd_update_proxy_library_entry(params: dict) -> dict:
    """Update an existing proxy library entry."""
    uid = _caller_uid(params)
    req = params.get("request", params)
    entry_id = str(req.get("id", ""))
    draft = _draft_from_dict(req.get("draft", {}))

    async def _op(db):
        result = await db.execute(
            select(ProxyLibraryEntry).where(
                and_(ProxyLibraryEntry.id == entry_id, _owner_filter(uid))
            )
        )
        entry = result.scalar_one_or_none()
        if entry is None:
            raise ValueError(f"Proxy entry not found: {entry_id}")
        apply_update(entry, draft)
        response = _entry_to_response(entry)  # plaintext after apply_update
        entry.username = _store_secret(entry.id, "username", entry.username)
        entry.password = _store_secret(entry.id, "password", entry.password)
        await db.flush()
        return response

    return await run_in_session(_op)


@register_command("delete_proxy_library_entry")
async def cmd_delete_proxy_library_entry(params: dict) -> dict:
    """Delete a proxy library entry."""
    uid = _caller_uid(params)
    req = params.get("request", params)
    entry_id = str(req.get("id", ""))

    async def _op(db):
        result = await db.execute(
            select(ProxyLibraryEntry).where(
                and_(ProxyLibraryEntry.id == entry_id, _owner_filter(uid))
            )
        )
        entry = result.scalar_one_or_none()
        if entry is None:
            return {"changed": False, "usage": {"profileAliases": [], "scenarioPaths": []}}
        _keyring_delete(_keyring_account(entry_id, "username"))
        _keyring_delete(_keyring_account(entry_id, "password"))
        await db.delete(entry)
        return {"changed": True, "usage": {"profileAliases": [], "scenarioPaths": []}}

    return await run_in_session(_op)


# ── Bulk import ───────────────────────────────────────────────────────────────


@register_command("import_proxy_library_bulk")
async def cmd_import_bulk(params: dict) -> dict:
    """Import proxies from bulk text."""
    uid = _caller_uid(params)
    req = params.get("request", params)
    raw_text = str(req.get("text", ""))
    default_type = str(req.get("defaultType", "http"))
    default_enabled = bool(req.get("defaultEnabled", True))

    async def _op(db):
        items = await load_proxy_library(db, uid)
        existing_count = len(items)
        result = import_lines(items, raw_text, default_type, default_enabled)
        # Encrypt + persist new entries (items[existing_count:])
        for entry in items[existing_count:]:
            entry.owner_id = uid
            entry.username = _store_secret(entry.id, "username", entry.username)
            entry.password = _store_secret(entry.id, "password", entry.password)
            db.add(entry)
        await db.flush()
        return _import_result_to_response(result)

    return await run_in_session(_op)


@register_command("preview_proxy_library_bulk", readonly=True)
async def cmd_preview_bulk(params: dict) -> dict:
    """Preview bulk import without saving."""
    uid = _caller_uid(params)
    req = params.get("request", params)
    raw_text = str(req.get("text", ""))
    default_type = str(req.get("defaultType", "http"))
    default_enabled = bool(req.get("defaultEnabled", True))

    async def _op(db):
        items = await load_proxy_library(db, uid)
        copy = list(items)
        result = import_lines(copy, raw_text, default_type, default_enabled)
        return _import_result_to_response(result)

    return await run_in_read_session(_op)


# ── Runtime URLs ──────────────────────────────────────────────────────────────


@register_command("get_proxy_library_runtime_proxy_url", readonly=True)
async def cmd_get_runtime_url(params: dict) -> str | None:
    """Resolve a proxy library entry ID to a proxy URL."""
    uid = _caller_uid(params)
    entry_id = str(params.get("id", ""))

    async def _op(db):
        result = await db.execute(
            select(ProxyLibraryEntry).where(
                and_(ProxyLibraryEntry.id == entry_id, _owner_filter(uid))
            )
        )
        entry = result.scalar_one_or_none()
        if entry is not None and entry.enabled:
            return entry_to_proxy_url(entry)
        return None

    return await run_in_read_session(_op)


@register_command("get_proxy_library_runtime_proxy_map", readonly=True)
async def cmd_get_runtime_map(params: dict) -> dict[str, str]:
    """Get a map of entry ID → proxy URL for all enabled entries."""
    uid = _caller_uid(params)

    async def _op(db):
        items = await load_proxy_library(db, uid)
        return {e.id: entry_to_proxy_url(e) for e in items if e.enabled}

    return await run_in_read_session(_op)


# ── Usage ─────────────────────────────────────────────────────────────────────


@register_command("get_proxy_library_usage")
async def cmd_get_usage(params: dict) -> dict:
    """Get usage info for a proxy entry (which accounts/scenarios reference it)."""
    return {"profileAliases": [], "scenarioPaths": []}


# ── Test ──────────────────────────────────────────────────────────────────────


@register_command("test_proxy_library_draft")
async def cmd_test_draft(params: dict) -> dict:
    """Test a proxy by making an HTTP request through it."""
    uid = _caller_uid(params)
    req = params.get("request", params)
    draft_data = req.get("draft", {})
    draft = _draft_from_dict(draft_data)
    persist = bool(req.get("persistResult", False))
    entry_id = req.get("proxyLibraryId")

    proxy_url = draft_to_proxy_url(draft)

    try:
        async with httpx.AsyncClient(proxy=proxy_url, timeout=15.0) as client:
            import time
            t0 = time.monotonic()
            resp = await client.get("https://httpbin.org/ip")
            latency = int((time.monotonic() - t0) * 1000)

        ip_data = resp.json()
        ip = ip_data.get("origin", "")
        success = resp.status_code == 200

        result = {
            "success": success,
            "responseTimeMs": latency,
            "ip": ip,
            "location": None,
            "error": None,
        }

        if persist and entry_id:
            await _persist_test_result(entry_id, success, latency, ip, None, None, uid)

        return result

    except Exception as exc:
        result = {
            "success": False,
            "responseTimeMs": None,
            "ip": None,
            "location": None,
            "error": str(exc),
        }

        if persist and entry_id:
            await _persist_test_result(entry_id, False, None, None, None, str(exc), uid)

        return result


async def _persist_test_result(
    entry_id: str,
    success: bool,
    latency_ms: int | None,
    ip: str | None,
    location: str | None,
    error: str | None,
    owner_id: int | None = None,
) -> None:
    """Save test results to the proxy entry."""

    async def _op(db):
        result = await db.execute(
            select(ProxyLibraryEntry).where(
                and_(ProxyLibraryEntry.id == entry_id, _owner_filter(owner_id))
            )
        )
        entry = result.scalar_one_or_none()
        if entry is None:
            return
        now = _now_iso()
        entry.last_test_at = now
        entry.last_test_ok = success
        entry.last_test_latency_ms = latency_ms
        entry.last_test_ip = ip
        entry.last_test_location = location
        entry.last_test_error = error
        entry.updated_at = now
        await db.flush()

    await run_in_session(_op)


# ── Save guard ────────────────────────────────────────────────────────────────


@register_command("ensure_proxy_save_use_allowed", readonly=True)
async def cmd_ensure_save_allowed(params: dict) -> bool:
    """Check if a proxy was recently tested OK (save guard)."""
    uid = _caller_uid(params)
    req = params.get("request", params)
    entry_id = str(req.get("proxyLibraryId", ""))
    max_age = int(req.get("maxAgeSeconds", 300))

    async def _op(db):
        import time as _time
        result = await db.execute(
            select(ProxyLibraryEntry).where(
                and_(ProxyLibraryEntry.id == entry_id, _owner_filter(uid))
            )
        )
        entry = result.scalar_one_or_none()
        if entry is None:
            return False
        if entry.last_test_ok is not True:
            return False
        if not entry.last_test_at:
            return False
        try:
            from datetime import datetime
            tested = datetime.fromisoformat(entry.last_test_at.replace("Z", "+00:00"))
            age = (_time.time() - tested.timestamp())
            return age <= max_age
        except Exception:
            return False

    return await run_in_read_session(_op)


# ── Parse ─────────────────────────────────────────────────────────────────────


@register_command("parse_proxy_library_input")
async def cmd_parse_input(params: dict) -> dict:
    """Parse a single proxy line into a draft."""
    req = params.get("request", params)
    raw = str(req.get("raw", ""))
    default_type = str(req.get("defaultType", "http"))

    try:
        draft = parse_proxy_line(raw, default_type)
        return {
            "label": draft.label,
            "host": draft.host,
            "port": draft.port,
            "username": draft.username,
            "password": draft.password,
            "proxyType": draft.proxy_type,
            "enabled": draft.enabled,
            "notes": draft.notes,
        }
    except ValueError as exc:
        raise ValueError(f"invalid_proxy_input|{exc}") from None


# ── Claim ─────────────────────────────────────────────────────────────────────


@register_command("claim_proxy_library_entry")
async def cmd_claim_proxy_library_entry(params: dict) -> dict:
    """Claim a shared (owner_id NULL) proxy entry for the caller.

    Sets ``owner_id = caller uid`` ONLY when the current owner_id is
    NULL.  Caller must be authenticated (uid not None) else 400.
    """
    await ensure_permission(params, "action.claim")
    uid = _caller_uid(params)
    if uid is None:
        raise ValueError("Authentication required to claim a shared entry")
    entry_id = str(params.get("id", ""))

    async def _op(db):
        result = await db.execute(
            select(ProxyLibraryEntry).where(ProxyLibraryEntry.id == entry_id)
        )
        entry = result.scalar_one_or_none()
        if entry is None:
            raise ValueError(f"Proxy entry not found: {entry_id}")
        if entry.owner_id is not None:
            raise ValueError("not shared")
        entry.owner_id = uid
        await db.flush()
        return _entry_to_response(entry, uid=uid)

    return await run_in_session(_op)
