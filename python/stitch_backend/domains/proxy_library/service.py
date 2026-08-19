"""Proxy library service — CRUD for proxy entries stored as ORM rows.

Each entry is a row in ``proxy_library_entries`` (see ``models.py``).
Secrets (username/password) are stored as encrypted references — the
keyring/XOR scheme is unchanged from the legacy JSON-blob era.
A one-time migration imports the old ``proxy_library_v1`` blob as
rows with ``owner_id = NULL`` (legacy shared pool).
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from sqlalchemy import func, or_, select, text

from stitch_backend.domains.proxy_library.models import (
    ProxyEntryGroupShare,
    ProxyLibraryEntry,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

SETTINGS_KEY = "proxy_library_v1"
KEYRING_SERVICE = "stitch-manager.proxy-library"
KEYRING_REF_PREFIX = "kr:v1:"
LEGACY_ENC_PREFIX = "enc:v1:"


# ── Data classes (drafts / import results only) ──────────────────────────────


@dataclass
class ProxyLibraryDraft:
    host: str
    port: int
    proxy_type: str = "http"
    label: str | None = None
    username: str | None = None
    password: str | None = None
    enabled: bool = True
    notes: str | None = None


@dataclass
class ProxyLibraryImportIssue:
    line_no: int
    line_preview: str
    reason: str


@dataclass
class ProxyLibraryImportResult:
    total_lines: int
    imported: int
    skipped: int
    issues: list[ProxyLibraryImportIssue] = field(default_factory=list)
    items: list[ProxyLibraryEntry] = field(default_factory=list)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _trim_to_opt(value: str | None) -> str | None:
    if value is None:
        return None
    v = value.strip()
    return v if v else None


def _stable_key(entry: ProxyLibraryEntry) -> str:
    username = _load_secret(entry.username) if entry.username else None
    password = _load_secret(entry.password) if entry.password else None
    return (
        f"{entry.proxy_type}|{entry.host.lower()}|{entry.port}"
        f"|{username or ''}|{password or ''}"
    )


def _draft_stable_key(draft: ProxyLibraryDraft) -> str:
    return (
        f"{draft.proxy_type}|{draft.host.strip().lower()}|{draft.port}"
        f"|{(draft.username or '').strip()}|{(draft.password or '').strip()}"
    )


def _entry_from_dict(d: dict[str, Any]) -> ProxyLibraryEntry:
    """Deserialize a camelCase dict (from legacy blob) into an ORM instance."""
    snake: dict[str, Any] = {}
    for k, v in d.items():
        # camelCase → snake_case
        s = re.sub(r"(?<!^)(?=[A-Z])", "_", k).lower()
        snake[s] = v
    return ProxyLibraryEntry(**snake)


# ── Secret storage (keyring + legacy XOR encryption) ──────────────────────────


def _derive_key() -> bytes:
    h = hashlib.sha256()
    h.update(b"stitch-proxy-library-v1")
    from pathlib import Path
    db_path = Path.home() / ".stitch" / "stitch.db"
    h.update(str(db_path).encode())
    h.update(str(Path.home()).encode())
    return h.digest()


def _xor_crypt(data: bytes, key: bytes) -> bytes:
    out = bytearray(len(data))
    for i, b in enumerate(data):
        k = key[i % len(key)] ^ (((i & 0xFF) * 31 + 17) & 0xFF)
        out[i] = b ^ k
    return bytes(out)


def _encrypt_legacy(value: str | None) -> str | None:
    v = _trim_to_opt(value)
    if v is None:
        return None
    key = _derive_key()
    ct = _xor_crypt(v.encode(), key)
    return f"{LEGACY_ENC_PREFIX}{base64.urlsafe_b64encode(ct).decode()}"


def _decrypt_legacy(value: str | None) -> str | None:
    v = _trim_to_opt(value)
    if v is None:
        return None
    if v.startswith(LEGACY_ENC_PREFIX):
        key = _derive_key()
        encoded = v[len(LEGACY_ENC_PREFIX):]
        ct = base64.urlsafe_b64decode(encoded)
        pt = _xor_crypt(ct, key)
        result = _trim_to_opt(pt.decode())
        return result
    return v  # plaintext legacy


def _keyring_account(entry_id: str, field_name: str) -> str:
    return f"proxy-library:{entry_id}:{field_name}"


def _store_secret(entry_id: str, field_name: str, value: str | None) -> str | None:
    plain = _trim_to_opt(value)
    account = _keyring_account(entry_id, field_name)
    if plain is None:
        _keyring_delete(account)
        return None
    if _keyring_set(account, plain):
        return f"{KEYRING_REF_PREFIX}{account}"
    return _encrypt_legacy(plain)


def _load_secret(value: str | None) -> str | None:
    raw = _trim_to_opt(value)
    if raw is None:
        return None
    if raw.startswith(KEYRING_REF_PREFIX):
        account = raw[len(KEYRING_REF_PREFIX):]
        return _keyring_get(account)
    if raw.startswith(LEGACY_ENC_PREFIX):
        return _decrypt_legacy(raw)
    return raw  # plaintext


def _keyring_set(account: str, secret: str) -> bool:
    try:
        import keyring as kr
        kr.set_password(KEYRING_SERVICE, account, secret)
        return True
    except Exception:
        return False


def _keyring_get(account: str) -> str | None:
    try:
        import keyring as kr
        val = kr.get_password(KEYRING_SERVICE, account)
        return _trim_to_opt(val)
    except Exception:
        return None


def _keyring_delete(account: str) -> None:
    try:
        import keyring as kr
        kr.delete_password(KEYRING_SERVICE, account)
    except Exception:
        pass


# ── DB load / save ────────────────────────────────────────────────────────────


async def load_proxy_library(
    db: AsyncSession,
    owner_id: int | None = None,
    group_ids: list[str] | None = None,
) -> list[ProxyLibraryEntry]:
    """Load proxy entries visible to *owner_id*.

    Visibility: own rows OR instance-shared (owner_id NULL) OR entries
    shared into one of *group_ids*.  When *group_ids* is empty/None,
    only own + instance-shared rows are returned.

    On first call when the table is completely empty, imports the legacy
    ``proxy_library_v1`` JSON blob as rows with ``owner_id = NULL``.
    The blob is left in place as a backup (not deleted).
    """
    count = (await db.execute(
        select(func.count()).select_from(ProxyLibraryEntry)
    )).scalar() or 0

    if count == 0:
        await _migrate_legacy_blob(db)

    visible = or_(
        ProxyLibraryEntry.owner_id.is_(None),
        ProxyLibraryEntry.owner_id == owner_id,
    )
    if group_ids:
        visible = or_(
            visible,
            ProxyLibraryEntry.id.in_(
                select(ProxyEntryGroupShare.entry_id).where(
                    ProxyEntryGroupShare.group_id.in_(group_ids)
                )
            ),
        )

    result = await db.execute(
        select(ProxyLibraryEntry).where(visible)
    )
    return list(result.scalars().all())


async def _migrate_legacy_blob(db: AsyncSession) -> None:
    """Import the legacy JSON blob as table rows (owner_id=NULL). No-op if blob absent."""
    row = (await db.execute(
        text("SELECT value FROM settings WHERE key = :key"),
        {"key": SETTINGS_KEY},
    )).scalar_one_or_none()

    if not row or not row.strip():
        return

    try:
        raw_list: list[dict[str, Any]] = json.loads(row)
    except (json.JSONDecodeError, TypeError):
        logger.error("Failed to parse proxy library JSON")
        return

    for d in raw_list:
        try:
            entry = _entry_from_dict(d)
            entry.owner_id = None  # legacy shared
            db.add(entry)
        except Exception as exc:
            logger.warning("Skipping invalid proxy entry: %s", exc)

    await db.flush()
    logger.info("Migrated %d proxy entries from legacy blob", len(raw_list))


# ── Entry construction ────────────────────────────────────────────────────────


def entry_from_draft(draft: ProxyLibraryDraft) -> ProxyLibraryEntry:
    now = _now_iso()
    host = draft.host.strip()
    label = _trim_to_opt(draft.label) or f"{host}:{draft.port}"
    return ProxyLibraryEntry(
        id=str(uuid.uuid4()),
        label=label,
        host=host,
        port=draft.port,
        username=_trim_to_opt(draft.username),
        password=_trim_to_opt(draft.password),
        proxy_type=draft.proxy_type,
        enabled=draft.enabled,
        notes=_trim_to_opt(draft.notes),
        created_at=now,
        updated_at=now,
    )


def apply_update(entry: ProxyLibraryEntry, draft: ProxyLibraryDraft) -> None:
    old_key = _stable_key(entry)
    entry.label = _trim_to_opt(draft.label) or f"{draft.host.strip()}:{draft.port}"
    entry.host = draft.host.strip()
    entry.port = draft.port
    entry.username = _trim_to_opt(draft.username)
    entry.password = _trim_to_opt(draft.password)
    entry.proxy_type = draft.proxy_type
    entry.enabled = draft.enabled
    entry.notes = _trim_to_opt(draft.notes)
    if _stable_key(entry) != old_key:
        entry.last_test_at = None
        entry.last_test_ok = None
        entry.last_test_latency_ms = None
        entry.last_test_error = None
        entry.last_test_ip = None
        entry.last_test_location = None
    entry.updated_at = _now_iso()


# ── Proxy line parsing ────────────────────────────────────────────────────────


def parse_proxy_line(raw: str, default_type: str = "http") -> ProxyLibraryDraft:
    line = raw.strip()
    if not line:
        raise ValueError("empty line")
    if line.startswith("#"):
        raise ValueError("comment")

    if "://" in line:
        parsed = urlparse(line)
        proxy_type = parsed.scheme if parsed.scheme in ("http", "socks5") else default_type
        host = (parsed.hostname or "").strip()
        if not host:
            raise ValueError("host is required")
        port = parsed.port
        if not port or port == 0:
            raise ValueError("port is required")
        username = _trim_to_opt(parsed.username) if parsed.username else None
        password = _trim_to_opt(parsed.password) if parsed.password else None
        return ProxyLibraryDraft(
            host=host, port=port, proxy_type=proxy_type,
            username=username, password=password, enabled=True,
        )

    parts = line.split(":")
    if len(parts) not in (2, 4):
        raise ValueError("expected host:port or host:port:username:password")

    host = parts[0].strip()
    if not host:
        raise ValueError("host is required")
    try:
        port = int(parts[1].strip())
    except ValueError:
        raise ValueError(f"invalid port: {parts[1].strip()}") from None
    if port == 0:
        raise ValueError("port must be > 0")

    username = _trim_to_opt(parts[2]) if len(parts) == 4 else None
    password = _trim_to_opt(parts[3]) if len(parts) == 4 else None

    return ProxyLibraryDraft(
        host=host, port=port, proxy_type=default_type,
        username=username, password=password, enabled=True,
    )


def draft_to_proxy_url(draft: ProxyLibraryDraft) -> str:
    auth = ""
    u = _trim_to_opt(draft.username)
    p = _trim_to_opt(draft.password)
    if u:
        auth = u
        if p:
            auth += f":{p}"
        auth += "@"
    return f"{draft.proxy_type}://{auth}{draft.host.strip()}:{draft.port}"


def entry_to_proxy_url(entry: ProxyLibraryEntry) -> str:
    auth = ""
    username = _load_secret(entry.username) if entry.username else None
    password = _load_secret(entry.password) if entry.password else None
    if username:
        auth = username
        if password:
            auth += f":{password}"
        auth += "@"
    return f"{entry.proxy_type}://{auth}{entry.host}:{entry.port}"


def _mask_preview(raw: str) -> str:
    line = raw.strip()
    if not line:
        return ""
    parts = line.split(":")
    if len(parts) >= 4:
        parts[-1] = "***"
    return ":".join(parts)


# ── Import ────────────────────────────────────────────────────────────────────


def import_lines(
    existing: list[ProxyLibraryEntry],
    text: str,
    default_type: str = "http",
    default_enabled: bool = True,
) -> ProxyLibraryImportResult:
    imported = 0
    skipped = 0
    issues: list[ProxyLibraryImportIssue] = []
    keys = {_stable_key(e) for e in existing}

    lines = text.splitlines()
    for idx, raw in enumerate(lines):
        line_no = idx + 1
        trimmed = raw.strip()
        if not trimmed or trimmed.startswith("#"):
            skipped += 1
            continue

        try:
            draft = parse_proxy_line(trimmed, default_type)
            draft.enabled = default_enabled
        except ValueError as exc:
            reason = str(exc)
            skipped += 1
            if reason not in ("comment", "empty line"):
                issues.append(ProxyLibraryImportIssue(
                    line_no=line_no, line_preview=_mask_preview(trimmed), reason=reason,
                ))
            continue

        entry = entry_from_draft(draft)
        entry.label = f"{entry.host}:{entry.port}"
        key = _stable_key(entry)
        if key in keys:
            skipped += 1
            issues.append(ProxyLibraryImportIssue(
                line_no=line_no, line_preview=_mask_preview(trimmed), reason="duplicate proxy",
            ))
            continue

        keys.add(key)
        existing.append(entry)
        imported += 1

    return ProxyLibraryImportResult(
        total_lines=len(lines), imported=imported, skipped=skipped,
        issues=issues, items=existing,
    )
