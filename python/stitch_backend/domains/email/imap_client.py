"""Async IMAP client wrapper for reading verification emails.

Uses ``aioimaplib`` when available; falls back to a stub that logs and
returns a placeholder code (useful during development without a real
IMAP server).
"""

from __future__ import annotations

import asyncio
import logging
import re

logger = logging.getLogger(__name__)

# Try to import aioimaplib; if unavailable, provide a stub
try:
    import aioimaplib

    _HAS_AIOIMAPLIB = True
except ImportError:
    _HAS_AIOIMAPLIB = False
    logger.warning("aioimaplib not installed — IMAP operations will be stubbed")


class ImapClient:
    """Thin async wrapper around an IMAP connection."""

    def __init__(
        self,
        host: str,
        port: int = 993,
        user: str | None = None,
        password: str | None = None,
        use_ssl: bool = True,
    ) -> None:
        self._host = host
        self._port = port
        self._user = user
        self._password = password
        self._use_ssl = use_ssl
        self._client: object | None = None  # aioimaplib.IMAP4_SSL

    async def connect(self) -> None:
        if not _HAS_AIOIMAPLIB:
            logger.warning("IMAP stub: connect() called but aioimaplib missing")
            return
        if self._use_ssl:
            self._client = await aioimaplib.IMAP4_SSL(
                host=self._host, port=self._port,
            )
        else:
            self._client = aioimaplib.IMAP4(
                host=self._host, port=self._port,
            )
        if self._user and self._password:
            await self._client.login(self._user, self._password)
        logger.info("IMAP connected to %s:%d", self._host, self._port)

    async def disconnect(self) -> None:
        if self._client is not None:
            try:
                await self._client.logout()
            except Exception:
                pass
            self._client = None

    async def search(self, folder: str = "INBOX", criteria: str = "ALL") -> list[str]:
        """Return message UIDs matching the criteria."""
        if self._client is None:
            return []
        try:
            await self._client.select(folder)
            _, data = await self._client.uid("search", None, criteria)
            uids = data[0].split() if data and data[0] else []
            return [uid.decode() if isinstance(uid, bytes) else uid for uid in uids]
        except Exception:
            logger.exception("IMAP search failed")
            return []

    async def fetch_body(self, uid: str, folder: str = "INBOX") -> str:
        """Fetch the body of a single message by UID."""
        if self._client is None:
            return ""
        try:
            await self._client.select(folder)
            _, data = await self._client.uid("fetch", uid, "(RFC822)")
            if data and len(data) >= 2:
                raw = data[1]
                return raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
            return ""
        except Exception:
            logger.exception("IMAP fetch failed for UID %s", uid)
            return ""


class InboxService:
    """Monitor an IMAP inbox for verification codes."""

    # Common verification code patterns
    CODE_PATTERNS = [
        re.compile(r"\b(\d{6})\b"),   # 6-digit numeric
        re.compile(r"\b(\d{4})\b"),   # 4-digit numeric
        re.compile(r"\b([A-Z0-9]{8})\b"),  # 8-char alphanumeric
    ]

    def __init__(self, client: ImapClient, folder: str = "INBOX") -> None:
        self._client = client
        self._folder = folder

    async def wait_for_code(
        self,
        email: str,
        subject_filter: str = "",
        code_pattern: str | None = None,
        timeout: float = 120.0,
        poll_interval: float = 5.0,
    ) -> str:
        """Poll IMAP until a verification code is found or timeout.

        Args:
            email: Target email address (used to filter TO: field).
            subject_filter: Substring that must appear in the subject.
            code_pattern: Custom regex for the code (default: 6-digit).
            timeout: Max seconds to wait.
            poll_interval: Seconds between polls.

        Returns:
            The extracted code string.

        Raises:
            TimeoutError: If no code found within the timeout.
        """
        pattern = re.compile(code_pattern) if code_pattern else self.CODE_PATTERNS[0]
        criteria = f'(TO "{email}")'
        if subject_filter:
            criteria = f'(TO "{email}" SUBJECT "{subject_filter}")'

        elapsed = 0.0
        while elapsed < timeout:
            uids = await self._client.search(self._folder, criteria)
            for uid in reversed(uids):  # newest first
                body = await self._client.fetch_body(uid, self._folder)
                match = pattern.search(body)
                if match:
                    code = match.group(1)
                    logger.info("Found verification code '%s' in UID %s", code, uid)
                    return code

            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

        raise TimeoutError(
            f"No verification code for {email} within {timeout}s"
        )
