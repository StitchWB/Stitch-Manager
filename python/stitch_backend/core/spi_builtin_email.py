"""Built-in SPI implementations for email verification and mail inbox.

This module is the ONLY place in core/ (besides the SPI registry itself)
that imports from ``domains.email`` and ``domains.email_inbox``.  The
grep-blocker test (``test_mail_spi_boundary.py``) enforces this boundary
— no other module in ``stitch_backend/`` or ``autoreg/`` may import from
``domains.email*`` directly.

Registered at import time via ``spi.register_impl()`` as built-in
fallbacks.  Service-plugins override them by registering with
``source="plugin"``.
"""

from __future__ import annotations

import asyncio
import email as email_mod
import logging
import re
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)


# ── Raw-IMAP helpers (moved from autoreg/plugin/capabilities.py) ──────────────


def _default_imap_factory(imap_config: dict[str, Any]) -> Any:
    """Create a real ``imaplib.IMAP4_SSL`` connection from config."""
    import imaplib  # noqa: PLC0415

    return imaplib.IMAP4_SSL(
        imap_config.get("host", ""), int(imap_config.get("port", 993))
    )


def _extract_body(msg: Any) -> str:
    """Extract text body from an ``email.message.Message``."""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode("utf-8", errors="replace")
            elif ct == "text/html" and not body:
                payload = part.get_payload(decode=True)
                if payload:
                    body = re.sub(
                        r"<[^>]*>", " ",
                        payload.decode("utf-8", errors="replace"),
                    )
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode("utf-8", errors="replace")
    return body


def _poll_imap_once(
    conn_factory: Callable[[dict[str, Any]], Any],
    imap_config: dict[str, Any],
    subject_patterns: list[str],
    body_regex: str,
    recency_s: int,
    code_source: str = "body",
    subject_code_regex: str = "",
) -> str | None:
    """Poll IMAP once for a verification code. Returns code or ``None``.

    ``subject_patterns`` are tried IN ORDER (primary first, fallback after)
    so a broad fallback never shadows a precise primary match on the same
    poll iteration.  An empty list disables subject filtering.

    ``code_source`` selects where the code lives:
      * ``"body"`` (default) — match ``body_regex`` against the email body.
      * ``"subject"`` — match ``subject_code_regex`` against the Subject
        header (windsurf: "229743 - Verify your Email with Windsurf").
    """
    from email.utils import parsedate_to_datetime  # noqa: PLC0415

    conn = conn_factory(imap_config)
    try:
        conn.login(imap_config.get("user", ""), imap_config.get("password", ""))
        conn.select("INBOX")
        status, data = conn.search(None, "ALL")
        if status != "OK" or not data[0]:
            return None
        msg_ids = data[0].split()
        subject_res = [re.compile(p) for p in subject_patterns if p]
        fetched: list[tuple[str, str]] = []
        for msg_id in reversed(msg_ids[-10:]):
            _, msg_data = conn.fetch(msg_id, "(RFC822)")
            if not msg_data or not msg_data[0]:
                continue
            msg = email_mod.message_from_bytes(msg_data[0][1])
            try:
                msg_date = parsedate_to_datetime(msg["Date"])
                if time.time() - msg_date.timestamp() > recency_s:
                    continue
            except Exception:  # noqa: BLE001
                pass
            fetched.append((msg.get("Subject", ""), _extract_body(msg)))

        if code_source == "subject":
            subject_code_re = re.compile(subject_code_regex or r"(\d{6})")
            for subject, _body in fetched:
                m = subject_code_re.search(subject)
                if m:
                    return m.group(1) if m.groups() else m.group(0)
            return None

        patterns: list[re.Pattern[str] | None] = subject_res or [None]
        for subject_re in patterns:
            for subject, body in fetched:
                if subject_re is not None and not subject_re.search(subject):
                    continue
                match = re.search(body_regex, body)
                if match:
                    return match.group(1) if match.groups() else match.group(0)
        return None
    finally:
        try:
            conn.logout()
        except Exception:  # noqa: BLE001
            pass


def _wait_otp_raw_sync(timeout: float, **kwargs: Any) -> str:
    """Sync raw-IMAP polling loop — moved from ``imap_otp_capability``.

    Returns the code, or raises ``TimeoutError`` if no code found within
    *timeout* seconds.  The ``**kwargs`` interface carries the step-level
    parameters (imap_config, subject_patterns, etc.) from
    ``imap_otp_capability`` through the SPI's ``wait_otp``.
    """
    factory = kwargs.get("imap_factory") or _default_imap_factory
    imap_config = kwargs.get("imap_config") or {}
    subject_patterns = kwargs.get("subject_patterns") or []
    body_regex = kwargs.get("body_regex", r"\b(\d{6})\b")
    recency_s = int(kwargs.get("recency_s", 600))
    poll_interval_s = float(kwargs.get("poll_interval_s", 5.0))
    code_source = kwargs.get("code_source", "body")
    subject_code_regex = kwargs.get("subject_code_regex", "")

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            code = _poll_imap_once(
                factory, imap_config, subject_patterns, body_regex, recency_s,
                code_source=code_source, subject_code_regex=subject_code_regex,
            )
            if code:
                return code
        except Exception as e:  # noqa: BLE001
            logger.debug("imap.otp poll error: %s", e)
        time.sleep(poll_interval_s)
    raise TimeoutError("imap.otp: no verification code received within timeout")


# ── Built-in EmailVerificationProvider ─────────────────────────────────────────


class _BuiltinEmailVerification:
    """Built-in ``EmailVerificationProvider`` — two delegation paths.

    When called with standard params only (by ``ImapVerificationStrategy``),
    delegates to ``EmailService.wait_for_verification_code``.

    When called with ``imap_config`` in kwargs (by ``imap_otp_capability``),
    uses raw-IMAP polling (moved from ``autoreg/plugin/capabilities.py``).
    """

    async def wait_otp(
        self,
        email: str,
        subject_filter: str = "",
        code_pattern: str | None = None,
        timeout: float = 120.0,
        **kwargs: Any,
    ) -> str:
        if "imap_config" in kwargs and kwargs["imap_config"]:
            return await asyncio.to_thread(
                _wait_otp_raw_sync, timeout, **kwargs
            )
        from stitch_backend.domains.email.service import EmailService  # noqa: PLC0415

        svc = EmailService()
        try:
            return await svc.wait_for_verification_code(
                email=email,
                subject_filter=subject_filter,
                code_pattern=code_pattern,
                timeout=timeout,
            )
        finally:
            await svc.close()

    async def close(self) -> None:
        pass  # EmailService is created per-call; nothing to close here.


# ── Built-in MailInboxSPI ─────────────────────────────────────────────────────


class _BuiltinMailInbox:
    """Built-in ``MailInboxSPI`` — wraps ``email_inbox`` service functions."""

    async def list_profiles(
        self, owner_id: int | None = None,
    ) -> list[dict[str, Any]]:
        from stitch_backend.database import run_in_read_session  # noqa: PLC0415
        from stitch_backend.domains.email_inbox import service  # noqa: PLC0415

        async def _op(db: Any) -> list[dict[str, Any]]:
            return await service.list_profiles(db, owner_id=owner_id)

        return await run_in_read_session(_op)

    async def wait_otp(
        self,
        email: str,
        subject_filter: str = "",
        code_pattern: str | None = None,
        timeout: float = 120.0,
    ) -> str:
        from stitch_backend.domains.email.service import EmailService  # noqa: PLC0415

        svc = EmailService()
        try:
            return await svc.wait_for_verification_code(
                email=email,
                subject_filter=subject_filter,
                code_pattern=code_pattern,
                timeout=timeout,
            )
        finally:
            await svc.close()

    async def sync(self, profile_id: str) -> dict[str, Any]:
        from stitch_backend.database import run_in_session  # noqa: PLC0415
        from stitch_backend.domains.email_inbox import service  # noqa: PLC0415

        async def _op(db: Any) -> dict[str, Any]:
            return await service.upsert_sync_state(db, {
                "profileId": profile_id,
                "status": "synced",
                "lastSyncAt": datetime.now(UTC).isoformat(),
            })

        return await run_in_session(_op)

    async def close(self) -> None:
        pass


# ── Registration ─────────────────────────────────────────────────────────────


def _register_builtins() -> None:
    """Register built-in EmailVerificationProvider and MailInboxSPI."""
    from stitch_backend.core.spi import (  # noqa: PLC0415
        SPI_EMAIL_VERIFICATION,
        SPI_MAIL_INBOX,
        register_impl,
    )
    register_impl(
        SPI_EMAIL_VERIFICATION,
        _BuiltinEmailVerification(),
        source="builtin",
    )
    register_impl(
        SPI_MAIL_INBOX,
        _BuiltinMailInbox(),
        source="builtin",
    )


_register_builtins()
