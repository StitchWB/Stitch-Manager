"""Mail.tm provider — REST-backed sessions matching the imap_provider shapes.

Blocking ``requests`` calls; the service layer wraps them in ``asyncio.to_thread``
exactly like it does for imaplib. Message dicts mirror
``imap_provider.fetch_message`` so the frontend cannot tell providers apart.
"""

from __future__ import annotations

import logging
import random
import string
from typing import Any, cast

from autoreg.services.mailtm import MailTmConfig, MailTmService

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.mail.tm"

MAILTM_CAPABILITIES: dict[str, bool] = {
    "canDelete": True,
    "canMarkAsRead": True,
    # ponytail: mail.tm API has no server-side search; we filter list items
    # client-side by from/subject/intro, which cannot cover full-body search.
    "canSearchBody": False,
    "canDownloadAttachments": False,
    "canListFolders": False,
}

INBOX_FOLDER: dict[str, Any] = {
    "id": "INBOX",
    "path": "INBOX",
    "name": "INBOX",
    "kind": "inbox",
    "delimiter": "/",
}


# ── Session lifecycle ─────────────────────────────────────────────────────────

def connect(address: str, password: str, base_url: str | None = None) -> MailTmService:
    svc = MailTmService(MailTmConfig(base_url=base_url or DEFAULT_BASE_URL))
    svc.login(address, password)
    return svc


def disconnect(svc: MailTmService) -> None:
    svc.close()


# ── Account creation ──────────────────────────────────────────────────────────

def create_random_account(base_url: str | None = None) -> dict[str, Any]:
    """Create a fresh mail.tm account with a random local part + password."""
    svc = MailTmService(MailTmConfig(base_url=base_url or DEFAULT_BASE_URL))
    try:
        domains = svc.get_domains()
        if not domains:
            raise RuntimeError("Mail.tm returned no available domains")
        domain = next(
            (d.get("domain") for d in domains if d.get("isActive", True) and d.get("domain")),
            domains[0].get("domain"),
        )
        if not domain:
            raise RuntimeError("Mail.tm returned no usable domain")

        local = "".join(random.choices(string.ascii_lowercase + string.digits, k=12))
        address = f"{local}@{domain}"
        password = "".join(random.choices(string.ascii_letters + string.digits, k=16))

        svc.create_account(address, password)
        # Fail fast if the account cannot be logged into — better to error here
        # than persist a dead profile.
        svc.login(address, password)
        return {"address": address, "password": password, "baseUrl": svc.config.base_url}
    finally:
        svc.close()


# ── Listing / fetching ────────────────────────────────────────────────────────

def list_messages(svc: MailTmService, query: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    query = query or {}
    limit = query.get("limit")
    items = svc.get_messages()
    if limit:
        # mail.tm returns newest first.
        items = items[: int(limit)]

    messages: list[dict[str, Any]] = []
    for item in items:
        if not _matches(item, query):
            continue
        try:
            # ponytail: one extra request per message so list results carry
            # full bodies (wait_for_email consumers read text/html directly).
            # Ceiling: slow for large inboxes; fine for temp mail.
            full = svc.get_message(str(item["id"]))
            messages.append(_to_email_message(full, item))
        except Exception:
            logger.warning("Skipping mail.tm message %s", item.get("id"), exc_info=True)
    return messages


def get_message(svc: MailTmService, message_id: str) -> dict[str, Any] | None:
    try:
        full = svc.get_message(message_id)
    except Exception:
        return None
    return _to_email_message(full, full)


def mark_as_read(svc: MailTmService, message_id: str) -> None:
    cast("Any", svc).mark_message_seen(message_id, True)


def delete_message(svc: MailTmService, message_id: str) -> None:
    cast("Any", svc).delete_message(message_id)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _matches(item: dict[str, Any], query: dict[str, Any]) -> bool:
    def _contains(hay: str, needle: str | None) -> bool:
        return not needle or needle.lower() in hay.lower()

    from_addr = ((item.get("from") or {}).get("address")) or ""
    subject = item.get("subject") or ""
    intro = item.get("intro") or ""

    if query.get("unreadOnly") and item.get("seen"):
        return False
    if not _contains(from_addr, query.get("from")):
        return False
    if not _contains(subject, query.get("subjectContains")):
        return False
    search = query.get("search")
    if search and not (
        _contains(subject, search) or _contains(from_addr, search) or _contains(intro, search)
    ):
        return False
    body = query.get("bodyContains")
    if body and not (_contains(intro, body) or _contains(subject, body)):
        return False
    return True


def _addr(value: dict[str, Any] | None) -> dict[str, Any]:
    value = value or {}
    return {"name": value.get("name") or None, "email": value.get("address") or ""}


def _to_email_message(full: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    html_parts = full.get("html")
    html = "\n".join(html_parts) if isinstance(html_parts, list) else (html_parts or None)
    message_id = str(full.get("id") or fallback.get("id") or "")
    return {
        "id": message_id,
        "providerMessageId": full.get("msgid") or fallback.get("msgid") or message_id,
        "from": _addr(full.get("from") or fallback.get("from")),
        "to": [_addr(a) for a in (full.get("to") or fallback.get("to") or [])],
        "cc": [_addr(a) for a in (full.get("cc") or [])],
        "bcc": [_addr(a) for a in (full.get("bcc") or [])],
        "subject": full.get("subject") or fallback.get("subject") or "",
        "text": full.get("text"),
        "html": html,
        "headers": {},
        "attachments": [],
        "isRead": bool(full.get("seen", fallback.get("seen", False))),
        "receivedAt": full.get("createdAt") or fallback.get("createdAt") or "",
    }
