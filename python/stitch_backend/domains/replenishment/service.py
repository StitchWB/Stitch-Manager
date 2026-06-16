"""Replenishment domain — auto-register accounts when quota is low.

Ports the Rust ``services/replenishment.rs`` module to Python.

The replenishment service runs as a background asyncio task, periodically
checking active account counts per provider and triggering registration
when counts fall below configured thresholds.

Settings are read from the ``settings`` table:
    - ``auto_replenish_enabled``
    - ``min_active_kiro``, ``min_active_windsurf``, ``min_active_trae``
    - Registration strategy per provider
    - IMAP credentials for email generation
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import string
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ── Settings ─────────────────────────────────────────────────────────────────

@dataclass
class ReplenishmentSettings:
    """Settings controlling auto-replenishment behaviour."""

    auto_replenish_enabled: bool = False
    min_active_kiro: int = 2
    min_active_windsurf: int = 2
    min_active_trae: int = 2
    kiro_reg_strategy: str = "counter"
    windsurf_reg_strategy: str = "counter"
    trae_reg_strategy: str = "counter"
    imap_user: str = ""
    imap_password: str = ""
    addyio_domain: str = ""
    imap_server: str = ""


# ── Status ───────────────────────────────────────────────────────────────────

@dataclass
class ReplenishmentStatus:
    """Current status of the replenishment service."""

    is_running: bool = False
    provider: Optional[str] = None
    step: Optional[str] = None
    email: Optional[str] = None
    error: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "isRunning": self.is_running,
            "provider": self.provider,
            "step": self.step,
            "email": self.email,
            "error": self.error,
            "startedAt": self.started_at,
            "completedAt": self.completed_at,
        }


# ── Service ──────────────────────────────────────────────────────────────────

class ReplenishmentService:
    """Background service that monitors account counts and triggers registration."""

    def __init__(self) -> None:
        self._status = ReplenishmentStatus()
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()

    @property
    def status(self) -> ReplenishmentStatus:
        return self._status

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    def _update_status(
        self,
        is_running: bool = False,
        provider: Optional[str] = None,
        step: Optional[str] = None,
        email: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        import time
        self._status.is_running = is_running
        if provider is not None:
            self._status.provider = provider
        if step is not None:
            self._status.step = step
        if email is not None:
            self._status.email = email
        if error is not None:
            self._status.error = error
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if is_running:
            self._status.started_at = now_iso
        else:
            self._status.completed_at = now_iso

    # ── Lifecycle ──────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Start the background replenishment loop."""
        if self._task and not self._task.done():
            logger.info("Replenishment service already running")
            return

        self._stop_event.clear()
        self._task = asyncio.create_task(self._loop())
        logger.info("Replenishment service started")

    async def stop(self) -> None:
        """Stop the background loop."""
        self._stop_event.set()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Replenishment service stopped")

    async def _loop(self) -> None:
        """Main loop: check every 60 seconds."""
        try:
            while not self._stop_event.is_set():
                try:
                    await self._check_and_replenish()
                except Exception:
                    logger.exception("Replenishment check error")

                # Wait 60s or until stop
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=60.0)
                except asyncio.TimeoutError:
                    pass  # Normal: 60s elapsed, loop again
        except asyncio.CancelledError:
            pass

    # ── Core logic ─────────────────────────────────────────────────────────

    async def _check_and_replenish(self) -> None:
        """Check all providers and trigger registration if needed."""
        from stitch_backend.database import run_in_session

        settings = await self._load_settings()

        if not settings.auto_replenish_enabled:
            return

        if self._status.is_running:
            logger.debug("Skipping check — registration already in progress")
            return

        providers = [
            ("kiro", settings.kiro_reg_strategy, settings.min_active_kiro),
            ("windsurf", settings.windsurf_reg_strategy, settings.min_active_windsurf),
            ("trae", settings.trae_reg_strategy, settings.min_active_trae),
        ]

        for provider, strategy, min_count in providers:
            active_count = await self._count_active(provider)

            if active_count < min_count:
                needed = min_count - active_count
                logger.info("Need to replenish %d account(s) for %s", needed, provider)

                # Trigger one registration per tick
                self._update_status(is_running=True, provider=provider, step="Generating email…")

                try:
                    await self._trigger_registration(provider, strategy, settings)
                except Exception as exc:
                    logger.error("Replenishment failed for %s: %s", provider, exc)
                    self._update_status(is_running=False, provider=provider, step="Error", error=str(exc)[:200])

                # Only one provider per tick to avoid conflicts
                break

    async def _trigger_registration(
        self, provider: str, strategy: str, settings: ReplenishmentSettings
    ) -> None:
        """Trigger a registration via the registration domain."""
        from stitch_backend.core.event_bus import event_bus

        # Generate a password
        password = self._generate_password()

        # Emit event to trigger registration through the registration domain
        await event_bus.emit("replenishment.requested", {
            "provider": provider,
            "strategy": strategy,
            "password": password,
            "imap_user": settings.imap_user,
            "addyio_domain": settings.addyio_domain,
        })

        self._update_status(
            is_running=False,
            provider=provider,
            step="Registration queued",
        )

    # ── Helpers ────────────────────────────────────────────────────────────

    async def _count_active(self, provider: str) -> int:
        from stitch_backend.database import run_in_session

        async def _op(session: AsyncSession) -> int:
            row = await session.execute(
                text(
                    "SELECT COUNT(*) FROM accounts "
                    "WHERE LOWER(provider) = :provider "
                    "AND status IN ('active', 'valid', 'online')"
                ),
                {"provider": provider.lower()},
            )
            return int(row.scalar() or 0)

        return await run_in_session(_op)

    async def _load_settings(self) -> ReplenishmentSettings:
        from stitch_backend.database import run_in_session

        async def _op(session: AsyncSession) -> ReplenishmentSettings:
            rows = (await session.execute(text("SELECT key, value FROM settings"))).fetchall()
            s = ReplenishmentSettings()
            for row in rows:
                key, value = row[0], row[1]
                if key == "auto_replenish_enabled":
                    s.auto_replenish_enabled = value == "true"
                elif key == "min_active_kiro":
                    s.min_active_kiro = int(value) if value.isdigit() else 2
                elif key == "min_active_windsurf":
                    s.min_active_windsurf = int(value) if value.isdigit() else 2
                elif key == "min_active_trae":
                    s.min_active_trae = int(value) if value.isdigit() else 2
                elif key == "kiro_reg_strategy":
                    s.kiro_reg_strategy = value
                elif key == "windsurf_reg_strategy":
                    s.windsurf_reg_strategy = value
                elif key == "trae_reg_strategy":
                    s.trae_reg_strategy = value
                elif key == "imap_user":
                    s.imap_user = value
                elif key == "imap_password":
                    s.imap_password = value
                elif key == "addyio_domain":
                    s.addyio_domain = value
                elif key == "imap_server":
                    s.imap_server = value
            return s

        return await run_in_session(_op)

    @staticmethod
    def _generate_password(length: int = 20) -> str:
        """Generate a strong random password."""
        chars = string.ascii_letters + string.digits + "!@#$%^&*"
        # Ensure at least one of each category
        pw = [
            secrets.choice(string.ascii_uppercase),
            secrets.choice(string.ascii_lowercase),
            secrets.choice(string.digits),
            secrets.choice("!@#$%^&*"),
        ]
        pw += [secrets.choice(chars) for _ in range(length - 4)]
        # Shuffle
        pw_list = list(pw)
        secrets.SystemRandom().shuffle(pw_list)
        return "".join(pw_list)


# ── Singleton ────────────────────────────────────────────────────────────────

_service: Optional[ReplenishmentService] = None


def get_replenishment_service() -> ReplenishmentService:
    global _service
    if _service is None:
        _service = ReplenishmentService()
    return _service
