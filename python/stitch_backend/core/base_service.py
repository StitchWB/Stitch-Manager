"""Base service class — shared session management and utilities.

Domain services extend this class and receive:
  - ``self._db``: the scoped AsyncSession
  - ``self._utcnow()``: consistent UTC timestamp helper

Usage::

    class ProfileSettingsService(BaseService):
        async def get_settings(self, alias: str) -> ProfileSettingsRecord | None:
            row = await self._db.execute(...)
            return row
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


def utcnow() -> datetime:
    """Return the current UTC time (timezone-aware)."""
    return datetime.now(UTC)


class BaseService:
    """Minimal base for domain service classes.

    Provides the database session and common helpers.
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    @staticmethod
    def _utcnow() -> datetime:
        return utcnow()
