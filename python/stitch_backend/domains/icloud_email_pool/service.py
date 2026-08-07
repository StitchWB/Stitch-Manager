"""
iCloud Hide My Email pool — service layer.

Responsibilities:
  - Persist and query pool entries in SQLite (via ORM).
  - Authenticate and hold a live ICloudService session.
  - Generate new aliases (respecting Apple's rate limit).
  - Expose a synchronous ``claim_next()`` for the autoreg bridge.
  - Register that bridge function on startup.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select, update

from stitch_backend.database import get_session_factory
from stitch_backend.domains.icloud_email_pool.models import ICloudEmailPoolEntry
from stitch_backend.domains.icloud_email_pool.schemas import ICloudPoolStatsResponse

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ── Singleton service instance (holds the live iCloud session) ─────────────

_instance: ICloudPoolService | None = None


def get_icloud_pool_service() -> ICloudPoolService:
    """Return the singleton service, creating it if necessary."""
    global _instance  # noqa: PLW0603
    if _instance is None:
        _instance = ICloudPoolService()
    return _instance


# ── Service ───────────────────────────────────────────────────────────────────

class ICloudPoolService:
    """Manages the iCloud Hide My Email address pool."""

    def __init__(self) -> None:
        self._icloud: Any | None = None     # ICloudService instance (lazy)
        self._cfg: Any | None = None        # ICloudConfig snapshot from settings
        self._loop: asyncio.AbstractEventLoop | None = None

    # ── Session management ────────────────────────────────────────────────────

    def configure(self, apple_id: str, app_password: str, cookie_dir: str = "") -> None:
        """
        (Re-)configure the underlying ICloudService with fresh credentials.

        Does NOT authenticate — call ``authenticate()`` next.
        """
        from autoreg.services.icloud import ICloudConfig, ICloudService

        self._cfg = ICloudConfig(
            apple_id=apple_id,
            app_specific_password=app_password,
            cookie_directory=cookie_dir or "",
        )
        self._icloud = ICloudService(self._cfg)
        logger.info("ICloudPoolService configured for %s", apple_id)

    def authenticate(self, verification_code: str | None = None) -> dict[str, Any]:
        """
        Authenticate (or complete 2FA) with iCloud.

        Returns:
            ``{"status": "ok"}`` on success,
            ``{"status": "2fa_required", "message": "..."}`` when 2FA is needed.

        Raises:
            RuntimeError: Service not configured.
            ICloudAuthError: Credentials invalid.
        """
        from autoreg.services.icloud import ICloudAuthError, TwoFactorRequired

        if self._icloud is None:
            raise RuntimeError("ICloudPoolService not configured. Call configure() first.")

        try:
            self._icloud.authenticate(verification_code=verification_code)
            return {"status": "ok"}
        except TwoFactorRequired as exc:
            return {"status": "2fa_required", "message": str(exc)}
        except ICloudAuthError as exc:
            raise RuntimeError(f"iCloud authentication failed: {exc}") from exc

    def is_authenticated(self) -> bool:
        return self._icloud is not None and self._icloud.is_authenticated()

    # ── Pool CRUD (async, for command handlers) ───────────────────────────────

    async def get_stats(self, db: AsyncSession) -> ICloudPoolStatsResponse:
        """Return pool statistics summary."""
        rows = await db.execute(
            select(
                ICloudEmailPoolEntry.status,
                func.count(ICloudEmailPoolEntry.id).label("cnt"),
            ).group_by(ICloudEmailPoolEntry.status)
        )
        counts: dict[str, int] = {row.status: row.cnt for row in rows}

        rate_remaining = 0
        rate_until = 0.0
        if self._icloud and self._icloud.is_authenticated():
            rate_remaining = self._icloud.rate_remaining()
            rate_until = self._icloud.rate_seconds_until_slot()

        return ICloudPoolStatsResponse(
            total=sum(counts.values()),
            available=counts.get("available", 0),
            reserved=counts.get("reserved", 0),
            used=counts.get("used", 0),
            failed=counts.get("failed", 0),
            deleted=counts.get("deleted", 0),
            rateRemaining=rate_remaining,
            rateSecondsUntilSlot=rate_until,
        )

    async def list_entries(
        self,
        db: AsyncSession,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ICloudEmailPoolEntry]:
        """List pool entries, optionally filtered by status."""
        q = select(ICloudEmailPoolEntry).order_by(
            ICloudEmailPoolEntry.created_at.desc()
        )
        if status:
            q = q.where(ICloudEmailPoolEntry.status == status)
        q = q.limit(limit).offset(offset)
        result = await db.execute(q)
        return list(result.scalars().all())

    async def fill_pool(
        self,
        db: AsyncSession,
        count: int = 5,
        label_prefix: str = "Auto-registration",
    ) -> list[ICloudEmailPoolEntry]:
        """
        Generate ``count`` new Hide My Email aliases and persist them.

        Respects Apple's rate limit — raises ``RuntimeError`` if exhausted.
        """
        from autoreg.services.icloud import RateLimitError

        if not self.is_authenticated():
            raise RuntimeError(
                "iCloud session not authenticated. "
                "Go to Settings → Email Services → iCloud and authenticate first."
            )

        created: list[ICloudEmailPoolEntry] = []
        for i in range(count):
            label = f"{label_prefix} #{i + 1}"
            try:
                alias = self._icloud.generate_alias(label)
            except RateLimitError as exc:
                logger.warning(
                    "Rate limit hit after %d/%d aliases: %s", i, count, exc
                )
                break

            entry = ICloudEmailPoolEntry(
                email=alias["email"],
                apple_alias_id=alias.get("id"),
                label=label,
                status="available",
                apple_id=self._cfg.apple_id if self._cfg else None,
            )
            db.add(entry)
            created.append(entry)
            logger.info("Pool += %s", alias["email"])

        await db.flush()
        return created

    async def release_entry(
        self,
        db: AsyncSession,
        entry_id: int,
        success: bool,
        account_id: str | None = None,
    ) -> None:
        """Mark a reserved entry as ``used`` or ``failed``."""
        now = datetime.now(UTC)
        new_status = "used" if success else "failed"
        values: dict = {"status": new_status}
        if success:
            values["used_at"] = now
            if account_id:
                values["used_by_account_id"] = account_id

        await db.execute(
            update(ICloudEmailPoolEntry)
            .where(ICloudEmailPoolEntry.id == entry_id)
            .values(**values)
        )

    async def delete_entry(self, db: AsyncSession, entry_id: int) -> None:
        """
        Deactivate the alias on Apple's side and mark the entry as deleted.
        """
        result = await db.execute(
            select(ICloudEmailPoolEntry).where(ICloudEmailPoolEntry.id == entry_id)
        )
        entry = result.scalar_one_or_none()
        if entry is None:
            raise ValueError(f"Pool entry {entry_id} not found")

        if self.is_authenticated() and entry.apple_alias_id:
            try:
                self._icloud.delete_alias(entry.apple_alias_id)
            except Exception as exc:
                logger.warning("Could not delete Apple alias %s: %s", entry.apple_alias_id, exc)

        entry.status = "deleted"
        db.add(entry)

    # ── Apple-only helpers (NO DB access) ──────────────────────────────────────

    def generate_aliases(
        self,
        count: int = 5,
        label_prefix: str = "Auto-registration",
    ) -> list[dict[str, Any]]:
        """
        Generate ``count`` new Hide My Email aliases via Apple's API.

        Pure Apple I/O — no DB session.  Call this OUTSIDE ``run_in_session``
        and persist results separately via :meth:`persist_aliases`.

        Respects Apple's rate limit — stops early if exhausted.
        Returns a list of ``{"email", "apple_alias_id", "label"}`` dicts.
        """
        from autoreg.services.icloud import RateLimitError

        if not self.is_authenticated():
            raise RuntimeError(
                "iCloud session not authenticated. "
                "Go to Settings → Email Services → iCloud and authenticate first."
            )

        aliases: list[dict[str, Any]] = []
        for i in range(count):
            label = f"{label_prefix} #{i + 1}"
            try:
                alias = self._icloud.generate_alias(label)
            except RateLimitError as exc:
                logger.warning(
                    "Rate limit hit after %d/%d aliases: %s", i, count, exc
                )
                break
            aliases.append({
                "email": alias["email"],
                "apple_alias_id": alias.get("id"),
                "label": label,
            })
            logger.info("Pool += %s", alias["email"])
        return aliases

    async def persist_aliases(
        self,
        db: AsyncSession,
        aliases: list[dict[str, Any]],
    ) -> list[ICloudEmailPoolEntry]:
        """
        Persist pre-generated aliases to the pool (DB only — no Apple API).

        Pair with :meth:`generate_aliases` so Apple I/O happens outside the
        write session.
        """
        created: list[ICloudEmailPoolEntry] = []
        for alias in aliases:
            entry = ICloudEmailPoolEntry(
                email=alias["email"],
                apple_alias_id=alias.get("apple_alias_id"),
                label=alias["label"],
                status="available",
                apple_id=self._cfg.apple_id if self._cfg else None,
            )
            db.add(entry)
            created.append(entry)

        await db.flush()
        return created

    def delete_alias_apple(self, apple_alias_id: str | None) -> None:
        """
        Deactivate an alias on Apple's side (pure Apple I/O — no DB session).

        Call this OUTSIDE ``run_in_session`` and persist the DB status change
        separately via :meth:`mark_entry_deleted`.
        """
        if self.is_authenticated() and apple_alias_id:
            try:
                self._icloud.delete_alias(apple_alias_id)
            except Exception as exc:
                logger.warning(
                    "Could not delete Apple alias %s: %s", apple_alias_id, exc
                )

    async def get_entry_apple_alias_id(
        self, db: AsyncSession, entry_id: int,
    ) -> str | None:
        """Return the ``apple_alias_id`` for an entry (read-only)."""
        result = await db.execute(
            select(ICloudEmailPoolEntry).where(ICloudEmailPoolEntry.id == entry_id)
        )
        entry = result.scalar_one_or_none()
        if entry is None:
            raise ValueError(f"Pool entry {entry_id} not found")
        return entry.apple_alias_id

    async def mark_entry_deleted(self, db: AsyncSession, entry_id: int) -> None:
        """Mark a pool entry as ``deleted`` (DB only — no Apple API)."""
        result = await db.execute(
            select(ICloudEmailPoolEntry).where(ICloudEmailPoolEntry.id == entry_id)
        )
        entry = result.scalar_one_or_none()
        if entry is None:
            raise ValueError(f"Pool entry {entry_id} not found")
        entry.status = "deleted"
        db.add(entry)

    # ── Synchronous claim for autoreg bridge ──────────────────────────────────

    def claim_next_sync(self) -> dict[str, Any] | None:
        """
        Claim the next available pool entry synchronously.

        This is called from ``autoreg`` provider code, which may run in a
        thread without an active event loop.  We spin up a new loop (or
        reuse one) to execute the async DB operation.

        Returns:
            Dict with ``id``, ``email``, ``label`` or ``None`` if pool empty.
        """
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # We're inside an async context (e.g. stitch_backend itself).
                # Create a future on the running loop.
                import concurrent.futures
                future: concurrent.futures.Future = concurrent.futures.Future()

                async def _inner() -> dict | None:
                    return await self._claim_next_async()

                def _run() -> None:
                    coro = _inner()
                    task = asyncio.ensure_future(coro)
                    task.add_done_callback(
                        lambda t: future.set_result(t.result())
                        if not t.exception()
                        else future.set_exception(t.exception())
                    )

                loop.call_soon_threadsafe(_run)
                return future.result(timeout=10)
            else:
                return loop.run_until_complete(self._claim_next_async())
        except Exception as exc:
            logger.error("claim_next_sync failed: %s", exc)
            return None

    async def _claim_next_async(self) -> dict[str, Any] | None:
        """Async implementation of claim_next."""
        factory = get_session_factory()
        async with factory() as session:
            try:
                result = await session.execute(
                    select(ICloudEmailPoolEntry)
                    .where(ICloudEmailPoolEntry.status == "available")
                    .order_by(ICloudEmailPoolEntry.created_at.asc())
                    .limit(1)
                    .with_for_update(skip_locked=True)
                )
                entry = result.scalar_one_or_none()
                if entry is None:
                    return None

                now = datetime.now(UTC)
                entry.status = "reserved"
                entry.reserved_at = now
                await session.commit()

                return {
                    "id": entry.id,
                    "email": entry.email,
                    "label": entry.label or "",
                }
            except Exception:
                await session.rollback()
                raise

    # ── Bridge registration ───────────────────────────────────────────────────

    def register_bridge(self) -> None:
        """
        Register ``claim_next_sync`` with the autoreg stitch_backend_bridge.

        Called once during stitch_backend lifespan so that all
        CommonProvider instances using ICLOUD_POOL strategy can dequeue
        pool entries without knowing about stitch_backend internals.
        """
        from autoreg.stitch_backend_bridge import set_icloud_pool_fetch_fn
        set_icloud_pool_fetch_fn(self.claim_next_sync)
        logger.info("iCloud pool bridge registered.")
