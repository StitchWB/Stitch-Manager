"""Settings ORM model — key-value table matching the Rust schema.

The Rust backend stores settings as rows in a ``settings`` table::

    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)

We map to the same table so we can read/write existing data.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Setting(Base):
    """Single key-value setting row."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[str | None] = mapped_column(String, nullable=True)
