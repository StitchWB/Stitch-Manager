"""IMAP provider — blocking IMAP operations (run via asyncio.to_thread).

Ported from Rust ``email_inbox/providers/imap.rs``.
All functions here are synchronous — the service layer wraps them in
``asyncio.to_thread`` for async compatibility.
"""

from __future__ import annotations

import imaplib
import logging
from email import message_from_bytes
from email.header import decode_header
from email.utils import parseaddr
from typing import Any

logger = logging.getLogger(__name__)


# ── Connection ────────────────────────────────────────────────────────────────

def connect(host: str, port: int, username: str, password: str, use_tls: bool) -> imaplib.IMAP4:
    """Open and authenticate an IMAP connection."""
    if use_tls:
        conn = imaplib.IMAP4_SSL(host, port)
    else:
        conn = imaplib.IMAP4(host, port)
    conn.login(username, password)
    return conn


def disconnect(conn: imaplib.IMAP4) -> None:
    """Logout and close the IMAP connection."""
    try:
        conn.logout()
    except Exception:
        pass


# ── Folder listing ────────────────────────────────────────────────────────────

def list_folders(conn: imaplib.IMAP4) -> list[dict[str, Any]]:
    """Return unique folders as [{id, path, name, kind, delimiter}]."""
    status, data = conn.list()
    if status != "OK":
        return []

    folders_by_path: dict[str, dict[str, Any]] = {}
    for item in data:
        if item is None:
            continue
        line = item.decode("utf-8", errors="replace") if isinstance(item, bytes) else str(item)
        # IMAP LIST format: (\Flags) "delimiter" "name"
        parts = line.split('"')
        if len(parts) >= 4:
            delimiter = parts[1] if len(parts) > 1 else "/"
            path = parts[3] if len(parts) > 3 else line
        else:
            delimiter = "/"
            path = line.split()[-1] if line.split() else "INBOX"

        flags = line.upper()
        if path.upper() == "INBOX" or "\\INBOX" in flags:
            kind = "inbox"
        elif "\\SENT" in flags:
            kind = "sent"
        elif "\\DRAFTS" in flags:
            kind = "drafts"
        elif "\\TRASH" in flags:
            kind = "trash"
        elif "\\JUNK" in flags or "\\SPAM" in flags:
            kind = "spam"
        elif "\\ALL" in flags:
            kind = "all"
        elif "\\ARCHIVE" in flags:
            kind = "archive"
        else:
            kind = "folder"

        name = path.rsplit(delimiter, 1)[-1] if delimiter else path
        folder = {
            "id": path,
            "path": path,
            "name": name,
            "kind": kind,
            "delimiter": delimiter,
        }
        canonical_path = path.strip().casefold()
        existing = folders_by_path.get(canonical_path)
        if existing is None or (existing["kind"] == "folder" and kind != "folder"):
            folders_by_path[canonical_path] = folder

    return list(folders_by_path.values())


# ── Search ────────────────────────────────────────────────────────────────────

def _imap_quote(value: str) -> str:
    """Escape a value for safe use inside IMAP quoted strings."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def search(conn: imaplib.IMAP4, query: dict[str, Any] | None) -> list[str]:
    """Run IMAP SEARCH and return a list of message UIDs (strings)."""
    criteria: list[str] = []
    q = query or {}
    if q.get("unreadOnly"):
        criteria.append("UNSEEN")
    if q.get("from"):
        criteria.append(f'FROM "{_imap_quote(q["from"])}"')
    if q.get("to"):
        criteria.append(f'TO "{_imap_quote(q["to"])}"')
    if q.get("subjectContains"):
        criteria.append(f'SUBJECT "{_imap_quote(q["subjectContains"])}"')
    if q.get("bodyContains"):
        criteria.append(f'BODY "{_imap_quote(q["bodyContains"])}"')
    if q.get("since"):
        criteria.append(f'SINCE {q["since"]}')
    search_str = " ".join(criteria) if criteria else "ALL"
    # Use UID SEARCH because every downstream operation (FETCH/STORE) treats
    # the returned identifier as a stable UID. Mixing sequence numbers from
    # SEARCH with UID FETCH caused valid messages to fail intermittently.
    status, data = conn.uid("search", None, search_str)
    if status != "OK":
        return []
    ids = data[0].split() if data and data[0] else []
    return [uid.decode() if isinstance(uid, bytes) else str(uid) for uid in ids]


# ── Message fetching ─────────────────────────────────────────────────────────

def fetch_message(conn: imaplib.IMAP4, uid: str) -> dict[str, Any]:
    """Fetch a single message by UID → dict matching EmailMessage schema."""
    status, data = conn.uid("fetch", uid, "(RFC822)")
    if status != "OK" or not data or data[0] is None:
        raise RuntimeError(f"Failed to fetch message UID {uid}")

    raw = data[0][1] if isinstance(data[0], tuple) else data[0]
    msg = message_from_bytes(raw)

    from_name, from_email = parseaddr(msg.get("From", ""))
    to_list = [
        {"name": n, "email": e}
        for n, e in [parseaddr(a) for a in (msg.get("To", "") or "").split(",")]
    ]
    subject = _decode_subject(msg.get("Subject", ""))

    text_body: str | None = None
    html_body: str | None = None
    attachments: list[dict[str, Any]] = []

    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            disp = str(part.get("Content-Disposition", ""))
            if ct == "text/plain" and "attachment" not in disp:
                payload = part.get_payload(decode=True)
                if payload:
                    text_body = payload.decode("utf-8", errors="replace")
            elif ct == "text/html" and "attachment" not in disp:
                payload = part.get_payload(decode=True)
                if payload:
                    html_body = payload.decode("utf-8", errors="replace")
            elif "attachment" in disp:
                fname = part.get_filename() or "unnamed"
                payload = part.get_payload(decode=True)
                attachments.append({
                    "id": str(len(attachments) + 1),
                    "filename": fname,
                    "contentType": ct,
                    "size": len(payload) if payload else 0,
                })
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            text_body = payload.decode("utf-8", errors="replace")

    return {
        "id": uid,
        "providerMessageId": msg.get("Message-ID", uid),
        "from": {"name": from_name or None, "email": from_email},
        "to": to_list,
        "cc": [],
        "bcc": [],
        "subject": subject,
        "text": text_body,
        "html": html_body,
        "headers": dict(msg.items()),
        "attachments": attachments,
        "isRead": False,
        "receivedAt": msg.get("Date", ""),
    }


# ── Mutations ─────────────────────────────────────────────────────────────────

def mark_as_read(conn: imaplib.IMAP4, uid: str) -> None:
    conn.select("INBOX")
    status, _ = conn.uid("store", uid, "+FLAGS", "(\\Seen)")
    if status != "OK":
        raise RuntimeError(f"Failed to mark message UID {uid} as read")


def delete_message(conn: imaplib.IMAP4, uid: str) -> None:
    conn.select("INBOX")
    status, _ = conn.uid("store", uid, "+FLAGS", "(\\Deleted)")
    if status != "OK":
        raise RuntimeError(f"Failed to delete message UID {uid}")
    conn.expunge()


# ── Internal helpers ──────────────────────────────────────────────────────────

def _decode_subject(raw: str) -> str:
    parts = decode_header(raw)
    decoded: list[str] = []
    for data, charset in parts:
        if isinstance(data, bytes):
            decoded.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(data)
    return " ".join(decoded)
