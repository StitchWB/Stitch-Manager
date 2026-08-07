"""Email counter service — CRUD and diagnostics for email_counters table.

Ported from Rust ``email_counter.rs`` and ``email_counter_diagnostics.rs``.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import select, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from stitch_backend.domains.email_counter.models import EmailCounter

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class EmailCounterService:
    """Manages per-provider/strategy email generation counters."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_counter(
        self, provider: str, strategy: str,
    ) -> int:
        """Return counter value; defaults to 0 if not found."""
        result = await self._db.execute(
            text(
                "SELECT counter FROM email_counters "
                "WHERE provider = :p AND strategy = :s"
            ),
            {"p": provider, "s": strategy},
        )
        row = result.first()
        return int(row[0]) if row else 0

    async def set_counter(
        self, provider: str, strategy: str, value: int,
    ) -> None:
        """Set counter to a specific value (upsert)."""
        now = datetime.now(UTC).isoformat()
        stmt = sqlite_insert(EmailCounter).values(
            provider=provider, strategy=strategy, counter=value, updated_at=now,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["provider", "strategy"],
            set_={"counter": value, "updated_at": now},
        )
        await self._db.execute(stmt)
        await self._db.flush()
        logger.info(
            "[EmailCounter] Set counter=%d for provider=%s strategy=%s",
            value, provider, strategy,
        )

    async def increment_counter(
        self, provider: str, strategy: str,
    ) -> int:
        """Atomically increment counter and return new value.

        Uses INSERT … ON CONFLICT DO UPDATE with ``counter + 1``
        to match Rust's transactional guarantee.
        """
        now = datetime.now(UTC).isoformat()
        stmt = sqlite_insert(EmailCounter).values(
            provider=provider, strategy=strategy, counter=1, updated_at=now,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["provider", "strategy"],
            set_={"counter": EmailCounter.counter + 1, "updated_at": now},
        )
        await self._db.execute(stmt)
        await self._db.flush()

        # Re-read to get the actual new value
        result = await self._db.execute(
            text(
                "SELECT counter FROM email_counters "
                "WHERE provider = :p AND strategy = :s"
            ),
            {"p": provider, "s": strategy},
        )
        return int(result.scalar_one())

    async def reset_counter(
        self, provider: str, strategy: str,
    ) -> None:
        """Reset counter to 0."""
        await self.set_counter(provider, strategy, 0)

    async def get_all_counters(self) -> list[dict[str, Any]]:
        """Return all counter rows as dicts."""
        result = await self._db.execute(
            select(EmailCounter).order_by(EmailCounter.updated_at.desc())
        )
        rows = result.scalars().all()
        return [
            {
                "provider": r.provider,
                "strategy": r.strategy,
                "counter": r.counter,
                "updatedAt": r.updated_at,
            }
            for r in rows
        ]

    async def get_diagnostics(self) -> dict[str, Any]:
        """Return comprehensive email counter diagnostics.

        Mirrors Rust ``get_email_counter_diagnostics``.
        """
        from stitch_backend.config import get_database_path

        db_path = get_database_path()
        db_path_str = str(db_path)
        db_exists = db_path.exists()
        import os
        db_writable = os.access(db_path, os.W_OK) if db_exists else False

        counters = await self.get_all_counters()

        # Last 5 generated emails from accounts table
        try:
            result = await self._db.execute(
                text(
                    "SELECT email, provider, created_at FROM accounts "
                    "ORDER BY created_at DESC LIMIT 5"
                )
            )
            rows = result.fetchall()
            last_emails: list[dict[str, Any]] = []
            for row in rows:
                email = row[0]
                counter = 0
                if "+" in email:
                    try:
                        counter = int(email.split("+")[1].split("@")[0])
                    except (ValueError, IndexError):
                        pass
                last_emails.append({
                    "email": email,
                    "counter": counter,
                    "provider": row[1],
                    "createdAt": row[2],
                })
        except Exception:
            last_emails = []

        # Current email strategy
        try:
            result = await self._db.execute(
                text("SELECT value FROM settings WHERE key = 'email_strategy'")
            )
            row = result.first()
            strategy = row[0] if row else "plus_alias"
        except Exception:
            strategy = "plus_alias"

        return {
            "databasePath": db_path_str,
            "databaseExists": db_exists,
            "databaseWritable": db_writable,
            "counters": counters,
            "lastGeneratedEmails": last_emails,
            "currentStrategy": strategy,
        }
