"""Generic CRUD repository for SQLAlchemy ORM models.

Eliminates boilerplate for common database operations.  Domain-specific
repositories extend this class and add custom query methods.

Usage::

    class ProfileRepo(BaseRepository[ProfileSettings]):
        _model = ProfileSettings
        _pk = "alias"

    repo = ProfileRepo(session)
    row = await repo.get_by_pk("user@example.com")
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Generic, TypeVar

from sqlalchemy import delete, func, select

from stitch_backend.database import Base

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=Base)


def _utcnow() -> datetime:
    return datetime.now(UTC)


class BaseRepository(Generic[T]):
    """Generic CRUD operations for a single ORM model.

    Subclasses must set:
      - ``_model``: the ORM class
      - ``_pk``: primary key column name (default ``"id"``)
    """

    _model: type[T]
    _pk: str = "id"

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Read ──────────────────────────────────────────────────────────────

    async def get_by_pk(self, pk_value: Any) -> T | None:
        pk_col = getattr(self._model, self._pk)
        stmt = select(self._model).where(pk_col == pk_value)
        result = await self._db.execute(stmt)
        return result.scalar_one_or_none()

    async def list_all(
        self,
        order_by: Any | None = None,
        limit: int | None = None,
    ) -> Sequence[T]:
        stmt = select(self._model)
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        if limit is not None:
            stmt = stmt.limit(limit)
        result = await self._db.execute(stmt)
        return result.scalars().all()

    async def find_by(self, **filters: Any) -> Sequence[T]:
        stmt = select(self._model)
        for key, value in filters.items():
            if value is not None and hasattr(self._model, key):
                stmt = stmt.where(getattr(self._model, key) == value)
        result = await self._db.execute(stmt)
        return result.scalars().all()

    async def count(self, **filters: Any) -> int:
        stmt = select(func.count()).select_from(self._model)
        for key, value in filters.items():
            if value is not None and hasattr(self._model, key):
                stmt = stmt.where(getattr(self._model, key) == value)
        result = await self._db.execute(stmt)
        return result.scalar_one()

    # ── Create ────────────────────────────────────────────────────────────

    async def create(self, **kwargs: Any) -> T:
        instance = self._model(**kwargs)
        self._db.add(instance)
        await self._db.flush()
        await self._db.refresh(instance)
        return instance

    # ── Update ────────────────────────────────────────────────────────────

    async def update_by_pk(self, pk_value: Any, **kwargs: Any) -> T | None:
        instance = await self.get_by_pk(pk_value)
        if instance is None:
            return None
        for key, value in kwargs.items():
            if hasattr(instance, key):
                setattr(instance, key, value)
        if hasattr(instance, "updated_at"):
            instance.updated_at = _utcnow()
        await self._db.flush()
        await self._db.refresh(instance)
        return instance

    # ── Delete ────────────────────────────────────────────────────────────

    async def delete_by_pk(self, pk_value: Any) -> bool:
        instance = await self.get_by_pk(pk_value)
        if instance is None:
            return False
        await self._db.delete(instance)
        await self._db.flush()
        return True

    async def delete_where(self, **filters: Any) -> int:
        stmt = delete(self._model)
        for key, value in filters.items():
            if value is not None and hasattr(self._model, key):
                stmt = stmt.where(getattr(self._model, key) == value)
        result = await self._db.execute(stmt)
        await self._db.flush()
        return int(result.rowcount)  # type: ignore[attr-defined]
