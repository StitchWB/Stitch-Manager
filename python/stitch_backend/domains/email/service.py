"""Email service — facade combining generation, IMAP, and inbox monitoring.

This is the entry point used by the registration orchestrator and the
command layer.  It delegates to the concrete strategies defined in
``strategies.py`` and the ``ImapClient``/``InboxService`` for IMAP ops.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from stitch_backend.config import get_settings
from stitch_backend.domains.email.imap_client import ImapClient, InboxService
from stitch_backend.domains.email.strategies import (
    AliasEmailStrategy,
    CounterImapStrategy,
    RandomEmailStrategy,
)

if TYPE_CHECKING:
    from stitch_backend.core.types import RegContext

logger = logging.getLogger(__name__)


class EmailService:
    """High-level email operations for the registration pipeline."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._imap_client: ImapClient | None = None
        self._inbox: InboxService | None = None

    # ── IMAP lifecycle ───────────────────────────────────────────────────────

    async def _get_imap(self) -> ImapClient:
        if self._imap_client is None:
            self._imap_client = ImapClient(
                host=self._settings.imap_host or "localhost",
                port=self._settings.imap_port,
                user=self._settings.imap_user,
                password=self._settings.imap_password,
            )
            await self._imap_client.connect()
        return self._imap_client

    async def close(self) -> None:
        if self._imap_client is not None:
            await self._imap_client.disconnect()
            self._imap_client = None
            self._inbox = None

    # ── Strategy factory ────────────────────────────────────────────────────

    def make_strategy(self, strategy_id: str = "counter_imap"):
        """Build an EmailStrategy from a settings-driven ID.

        Supported IDs: ``counter_imap``, ``alias``, ``random``.
        """
        if strategy_id == "counter_imap":
            domain = self._settings.imap_user or "example.com"
            if "@" in domain:
                domain = domain.rsplit("@", 1)[1]
            return CounterImapStrategy(domain=domain, prefix="user")
        elif strategy_id == "alias":
            base = self._settings.imap_user or "user@gmail.com"
            return AliasEmailStrategy(base_email=base)
        else:
            return RandomEmailStrategy()

    # ── High-level operations ───────────────────────────────────────────────

    async def acquire_email(
        self, ctx: RegContext, strategy_id: str = "counter_imap"
    ) -> str:
        strategy = self.make_strategy(strategy_id)
        email = await strategy.acquire_email(ctx)
        ctx.email = email
        return email

    async def wait_for_verification_code(
        self,
        email: str,
        subject_filter: str = "",
        code_pattern: str | None = None,
        timeout: float = 120.0,
    ) -> str:
        client = await self._get_imap()
        if self._inbox is None:
            self._inbox = InboxService(client, folder=self._settings.imap_folder)
        return await self._inbox.wait_for_code(
            email=email,
            subject_filter=subject_filter,
            code_pattern=code_pattern,
            timeout=timeout,
        )

    async def generate_email(self, strategy_id: str = "random") -> str:
        """Standalone email generation (not tied to a registration context)."""
        from stitch_backend.core.types import RegContext
        ctx = RegContext(provider_id="manual")
        return await self.acquire_email(ctx, strategy_id)
