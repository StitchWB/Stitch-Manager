"""Proxy library command handlers.

Exposes CRUD, bulk import, proxy testing, and runtime URL resolution
to the frontend via the command registry.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

import httpx

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.proxy_library.service import (
    ProxyLibraryDraft,
    ProxyLibraryEntry,
    ProxyLibraryImportResult,
    apply_update,
    draft_to_proxy_url,
    entry_from_draft,
    entry_to_proxy_url,
    import_lines,
    load_proxy_library,
    parse_proxy_line,
    save_proxy_library,
)

logger = logging.getLogger(__name__)


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


def _entry_to_response(entry: ProxyLibraryEntry) -> dict[str, Any]:
    """Serialize an entry to a camelCase dict for the frontend."""
    d = asdict(entry)
    result: dict[str, Any] = {}
    for k, v in d.items():
        if v is None and k in (
            "username", "password", "notes", "last_test_at", "last_test_ok",
            "last_test_latency_ms", "last_test_error", "last_test_ip", "last_test_location",
        ):
            continue
        parts = k.split("_")
        camel = parts[0] + "".join(p.capitalize() for p in parts[1:])
        result[camel] = v
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


# ── CRUD ──────────────────────────────────────────────────────────────────────


@register_command("list_proxy_library", readonly=True)
async def cmd_list_proxy_library(params: dict) -> list[dict]:
    """List all proxy library entries."""
    async def _op(db):
        items = await load_proxy_library(db)
        return [_entry_to_response(e) for e in items]
    return await run_in_read_session(_op)


@register_command("create_proxy_library_entry")
async def cmd_create_proxy_library_entry(params: dict) -> dict:
    """Create a new proxy library entry from a draft."""
    draft = _draft_from_dict(params.get("draft", params))

    async def _op(db):
        entry = entry_from_draft(draft)
        items = await load_proxy_library(db)
        items.append(entry)
        await save_proxy_library(db, items)
        return _entry_to_response(entry)

    return await run_in_session(_op)


@register_command("create_or_get_proxy_library_entry")
async def cmd_create_or_get(params: dict) -> dict:
    """Create entry or return existing one with same stable key."""
    draft = _draft_from_dict(params.get("draft", params))

    async def _op(db):
        from stitch_backend.domains.proxy_library.service import _draft_stable_key, _stable_key
        target_key = _draft_stable_key(draft)
        items = await load_proxy_library(db)
        for existing in items:
            if _stable_key(existing) == target_key:
                return _entry_to_response(existing)
        entry = entry_from_draft(draft)
        items.append(entry)
        await save_proxy_library(db, items)
        return _entry_to_response(entry)

    return await run_in_session(_op)


@register_command("update_proxy_library_entry")
async def cmd_update_proxy_library_entry(params: dict) -> dict:
    """Update an existing proxy library entry."""
    req = params.get("request", params)
    entry_id = str(req.get("id", ""))
    draft = _draft_from_dict(req.get("draft", {}))

    async def _op(db):
        items = await load_proxy_library(db)
        for entry in items:
            if entry.id == entry_id:
                apply_update(entry, draft)
                await save_proxy_library(db, items)
                return _entry_to_response(entry)
        raise ValueError(f"Proxy entry not found: {entry_id}")

    return await run_in_session(_op)


@register_command("delete_proxy_library_entry")
async def cmd_delete_proxy_library_entry(params: dict) -> dict:
    """Delete a proxy library entry."""
    req = params.get("request", params)
    entry_id = str(req.get("id", ""))

    async def _op(db):
        from stitch_backend.domains.proxy_library.service import _keyring_account, _keyring_delete
        items = await load_proxy_library(db)
        new_items = [e for e in items if e.id != entry_id]
        if len(new_items) == len(items):
            return {"changed": False, "usage": {"profileAliases": [], "scenarioPaths": []}}
        # Cleanup keyring secrets
        _keyring_delete(_keyring_account(entry_id, "username"))
        _keyring_delete(_keyring_account(entry_id, "password"))
        await save_proxy_library(db, new_items)
        return {"changed": True, "usage": {"profileAliases": [], "scenarioPaths": []}}

    return await run_in_session(_op)


# ── Bulk import ───────────────────────────────────────────────────────────────


@register_command("import_proxy_library_bulk")
async def cmd_import_bulk(params: dict) -> dict:
    """Import proxies from bulk text."""
    req = params.get("request", params)
    raw_text = str(req.get("text", ""))
    default_type = str(req.get("defaultType", "http"))
    default_enabled = bool(req.get("defaultEnabled", True))

    async def _op(db):
        items = await load_proxy_library(db)
        result = import_lines(items, raw_text, default_type, default_enabled)
        if result.imported > 0:
            await save_proxy_library(db, result.items)
        return _import_result_to_response(result)

    return await run_in_session(_op)


@register_command("preview_proxy_library_bulk", readonly=True)
async def cmd_preview_bulk(params: dict) -> dict:
    """Preview bulk import without saving."""
    req = params.get("request", params)
    raw_text = str(req.get("text", ""))
    default_type = str(req.get("defaultType", "http"))
    default_enabled = bool(req.get("defaultEnabled", True))

    async def _op(db):
        items = await load_proxy_library(db)
        # Work on a copy
        copy = list(items)
        result = import_lines(copy, raw_text, default_type, default_enabled)
        return _import_result_to_response(result)

    return await run_in_read_session(_op)


# ── Runtime URLs ──────────────────────────────────────────────────────────────


@register_command("get_proxy_library_runtime_proxy_url", readonly=True)
async def cmd_get_runtime_url(params: dict) -> str | None:
    """Resolve a proxy library entry ID to a proxy URL."""
    entry_id = str(params.get("id", ""))

    async def _op(db):
        items = await load_proxy_library(db)
        for entry in items:
            if entry.id == entry_id and entry.enabled:
                return entry_to_proxy_url(entry)
        return None

    return await run_in_read_session(_op)


@register_command("get_proxy_library_runtime_proxy_map", readonly=True)
async def cmd_get_runtime_map(params: dict) -> dict[str, str]:
    """Get a map of entry ID → proxy URL for all enabled entries."""
    async def _op(db):
        items = await load_proxy_library(db)
        return {e.id: entry_to_proxy_url(e) for e in items if e.enabled}

    return await run_in_read_session(_op)


# ── Usage ─────────────────────────────────────────────────────────────────────


@register_command("get_proxy_library_usage")
async def cmd_get_usage(params: dict) -> dict:
    """Get usage info for a proxy entry (which accounts/scenarios reference it)."""
    # TODO: scan accounts table and scenario files for references
    return {"profileAliases": [], "scenarioPaths": []}


# ── Test ──────────────────────────────────────────────────────────────────────


@register_command("test_proxy_library_draft")
async def cmd_test_draft(params: dict) -> dict:
    """Test a proxy by making an HTTP request through it."""
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
            await _persist_test_result(entry_id, success, latency, ip, None, None)

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
            await _persist_test_result(entry_id, False, None, None, None, str(exc))

        return result


async def _persist_test_result(
    entry_id: str,
    success: bool,
    latency_ms: int | None,
    ip: str | None,
    location: str | None,
    error: str | None,
) -> None:
    """Save test results to the proxy entry."""
    from stitch_backend.domains.proxy_library.service import _now_iso

    async def _op(db):
        items = await load_proxy_library(db)
        for entry in items:
            if entry.id == entry_id:
                now = _now_iso()
                entry.last_test_at = now
                entry.last_test_ok = success
                entry.last_test_latency_ms = latency_ms
                entry.last_test_ip = ip
                entry.last_test_location = location
                entry.last_test_error = error
                entry.updated_at = now
                await save_proxy_library(db, items)
                return
    await run_in_session(_op)


# ── Save guard ────────────────────────────────────────────────────────────────


@register_command("ensure_proxy_save_use_allowed", readonly=True)
async def cmd_ensure_save_allowed(params: dict) -> bool:
    """Check if a proxy was recently tested OK (save guard)."""
    req = params.get("request", params)
    entry_id = str(req.get("proxyLibraryId", ""))
    max_age = int(req.get("maxAgeSeconds", 300))

    async def _op(db):
        import time as _time
        items = await load_proxy_library(db)
        for entry in items:
            if entry.id == entry_id:
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
