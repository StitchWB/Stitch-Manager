"""Email Inbox service — session management + profile/sync-state CRUD.

Ported from Rust ``email_inbox/service.rs`` and ``email_inbox_profiles.rs``.
Sessions are in-memory; profiles and sync states live in SQLite.
IMAP blocking calls are delegated to ``imap_provider`` via ``asyncio.to_thread``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from stitch_backend.domains.email_inbox import imap_provider
from stitch_backend.domains.email_inbox.models import (
    EmailInboxProfile,
    EmailInboxSyncState,
)

logger = logging.getLogger(__name__)

PASSWORD_SENTINEL = "********"

_IMAP_CAPABILITIES: dict[str, bool] = {
    "canDelete": True,
    "canMarkAsRead": True,
    "canSearchBody": True,
    "canDownloadAttachments": False,
    "canListFolders": True,
}

# ── In-memory session store ───────────────────────────────────────────────────

_sessions: dict[str, dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_sqlite() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _get_session(session_id: str) -> dict[str, Any]:
    sess = _sessions.get(session_id)
    if not sess:
        raise RuntimeError(f"Session not found: {session_id}")
    return sess


# ── Session operations ────────────────────────────────────────────────────────

async def connect(input_data: dict[str, Any]) -> dict[str, Any]:
    """Connect to a mailbox and return a session descriptor."""
    provider = input_data.get("provider", "imap")
    account_id = input_data.get("accountId", "").strip()
    creds = input_data.get("credentials", {})

    if provider != "imap":
        raise RuntimeError(f"Provider not supported: {provider}")

    imap_creds = creds.get("value", creds)
    host = imap_creds.get("host", "")
    port = int(imap_creds.get("port", 993))
    username = imap_creds.get("username", "")
    password = imap_creds.get("password", "")
    use_tls = imap_creds.get("useTls", imap_creds.get("use_tls", True))

    if password == PASSWORD_SENTINEL or not password:
        password = await _resolve_imap_password(host)

    conn = await asyncio.to_thread(
        imap_provider.connect, host, port, username, password, use_tls,
    )
    session_id = str(uuid.uuid4())
    _sessions[session_id] = {"provider": "imap", "conn": conn}
    return {
        "sessionId": session_id,
        "provider": provider,
        "accountId": account_id,
        "capabilities": _IMAP_CAPABILITIES,
        "connectedAt": _now_iso(),
    }


async def disconnect(session_id: str) -> None:
    sess = _sessions.pop(session_id, None)
    if sess and sess.get("conn"):
        await asyncio.to_thread(imap_provider.disconnect, sess["conn"])


async def list_messages(
    session_id: str, query: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    sess = _get_session(session_id)
    conn = sess["conn"]
    limit = (query or {}).get("limit")

    def _do() -> list[dict[str, Any]]:
        conn.select("INBOX", readonly=True)
        uids = imap_provider.search(conn, query)
        if limit:
            uids = uids[-int(limit):]
        return [imap_provider.fetch_message(conn, uid) for uid in uids]

    return await asyncio.to_thread(_do)


async def list_folders(session_id: str) -> list[dict[str, Any]]:
    sess = _get_session(session_id)
    return await asyncio.to_thread(imap_provider.list_folders, sess["conn"])


async def get_by_id(session_id: str, message_id: str) -> dict[str, Any] | None:
    sess = _get_session(session_id)
    conn = sess["conn"]

    def _do() -> dict[str, Any] | None:
        conn.select("INBOX", readonly=True)
        try:
            return imap_provider.fetch_message(conn, message_id)
        except Exception:
            return None

    return await asyncio.to_thread(_do)


async def wait_for_email(
    session_id: str,
    query: dict[str, Any],
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    opts = options or {}
    timeout_s = (opts.get("timeoutMs", opts.get("timeout_ms", 120_000))) / 1000.0
    poll_s = (opts.get("pollIntervalMs", opts.get("poll_interval_ms", 3_000))) / 1000.0

    deadline = asyncio.get_event_loop().time() + timeout_s
    while asyncio.get_event_loop().time() < deadline:
        messages = await list_messages(session_id, query)
        if messages:
            return messages[0]
        await asyncio.sleep(poll_s)
    raise RuntimeError("Email not found within timeout")


async def mark_as_read(session_id: str, message_id: str) -> None:
    sess = _get_session(session_id)
    await asyncio.to_thread(imap_provider.mark_as_read, sess["conn"], message_id)


async def delete_message(session_id: str, message_id: str) -> None:
    sess = _get_session(session_id)
    await asyncio.to_thread(imap_provider.delete_message, sess["conn"], message_id)


def get_capabilities(session_id: str) -> dict[str, bool]:
    _get_session(session_id)
    return _IMAP_CAPABILITIES


def get_provider_catalog() -> list[dict[str, Any]]:
    return [
        {
            "provider": "imap", "displayName": "IMAP",
            "available": True, "capabilities": _IMAP_CAPABILITIES,
            "supportsProfileConnect": True,
        },
        {
            "provider": "mail_tm", "displayName": "Mail.tm",
            "available": False,
            "capabilities": {
                "canDelete": True, "canMarkAsRead": True,
                "canSearchBody": True, "canDownloadAttachments": True,
                "canListFolders": False,
            },
            "supportsProfileConnect": True,
        },
    ]


# ── Profile CRUD ──────────────────────────────────────────────────────────────

async def list_profiles(db: AsyncSession) -> list[dict[str, Any]]:
    result = await db.execute(
        select(EmailInboxProfile).order_by(EmailInboxProfile.updated_at.desc())
    )
    return [_profile_to_dict(r) for r in result.scalars().all()]


async def get_profile(db: AsyncSession, profile_id: str) -> dict[str, Any] | None:
    result = await db.execute(
        select(EmailInboxProfile).where(EmailInboxProfile.id == profile_id)
    )
    row = result.scalar_one_or_none()
    return _profile_to_dict(row) if row else None


async def upsert_profile(db: AsyncSession, input_data: dict[str, Any]) -> dict[str, Any]:
    pid = (input_data.get("id") or "").strip() or str(uuid.uuid4())
    ci = input_data.get("connectInput", input_data.get("connect_input", {}))
    provider = ci.get("provider", "imap")
    account_id = ci.get("accountId", ci.get("account_id", ""))
    label = (input_data.get("label") or "").strip() or f"{provider} · {account_id}"
    connect_json = json.dumps(ci, ensure_ascii=False)
    now = _now_sqlite()

    stmt = sqlite_insert(EmailInboxProfile).values(
        id=pid, label=label, provider=provider,
        account_id=account_id, connect_input_json=connect_json,
        created_at=now, updated_at=now,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "label": label, "provider": provider,
            "account_id": account_id, "connect_input_json": connect_json,
            "updated_at": now,
        },
    )
    await db.execute(stmt)
    await db.flush()
    return (await get_profile(db, pid)) or {}


async def delete_profile(db: AsyncSession, profile_id: str) -> bool:
    result = await db.execute(
        text("DELETE FROM email_inbox_profiles WHERE id = :id"),
        {"id": profile_id},
    )
    await db.flush()
    return result.rowcount > 0


async def connect_profile(db: AsyncSession, profile_id: str) -> dict[str, Any]:
    profile = await get_profile(db, profile_id)
    if not profile:
        raise RuntimeError(f"Profile not found: {profile_id}")
    ci = profile.get("connectInput", profile.get("connect_input", {}))
    return await connect(ci)


# ── Sync state CRUD ───────────────────────────────────────────────────────────

async def get_sync_state(db: AsyncSession, profile_id: str) -> dict[str, Any] | None:
    result = await db.execute(
        select(EmailInboxSyncState).where(EmailInboxSyncState.profile_id == profile_id)
    )
    row = result.scalar_one_or_none()
    return _sync_state_to_dict(row) if row else None


async def upsert_sync_state(db: AsyncSession, input_data: dict[str, Any]) -> dict[str, Any]:
    pid = input_data.get("profileId", input_data.get("profile_id", "")).strip()
    if not pid:
        raise ValueError("profileId is required")
    status = input_data.get("status", "idle")
    last_sync_at = input_data.get("lastSyncAt", input_data.get("last_sync_at"))
    last_error = input_data.get("lastError", input_data.get("last_error"))
    cursor_val = input_data.get("cursor")
    now = _now_sqlite()

    stmt = sqlite_insert(EmailInboxSyncState).values(
        profile_id=pid, status=status,
        last_sync_at=last_sync_at, last_error=last_error,
        cursor=cursor_val, updated_at=now,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["profile_id"],
        set_={
            "status": status, "last_sync_at": last_sync_at,
            "last_error": last_error, "cursor": cursor_val,
            "updated_at": now,
        },
    )
    await db.execute(stmt)
    await db.flush()
    return (await get_sync_state(db, pid)) or {}


# ── Serializers ───────────────────────────────────────────────────────────────

def _profile_to_dict(row: EmailInboxProfile) -> dict[str, Any]:
    try:
        connect_input = json.loads(row.connect_input_json)
    except (json.JSONDecodeError, TypeError):
        connect_input = {}
    return {
        "id": row.id, "label": row.label, "provider": row.provider,
        "accountId": row.account_id, "connectInput": connect_input,
        "createdAt": row.created_at, "updatedAt": row.updated_at,
    }


def _sync_state_to_dict(row: EmailInboxSyncState) -> dict[str, Any]:
    return {
        "profileId": row.profile_id, "status": row.status,
        "lastSyncAt": row.last_sync_at, "lastError": row.last_error,
        "cursor": row.cursor, "updatedAt": row.updated_at,
    }


async def _resolve_imap_password(host: str) -> str:
    """Resolve sentinel password from settings table."""
    from stitch_backend.database import run_in_session
    setting_key = "gmailAppPassword" if "gmail" in host.lower() else "imapPassword"

    async def _fetch(db: AsyncSession) -> str:
        result = await db.execute(
            text("SELECT value FROM settings WHERE key = :k"), {"k": setting_key},
        )
        row = result.first()
        return row[0] if row else ""

    try:
        return await run_in_session(_fetch)
    except Exception:
        return ""
