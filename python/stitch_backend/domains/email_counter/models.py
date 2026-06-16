"""Email counter ORM model — tracks email generation counters per provider/strategy.

Matches the Rust ``email_counters`` table created inline in migrations.rs::

    CREATE TABLE email_counters (
        provider TEXT NOT NULL,
        strategy TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (provider, strategy)
    )
"""

from __future__ import annotations

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base


class EmailCounter(Base):
    """Per-provider/strategy email generation counter."""

    __tablename__ = "email_counters"

    provider: Mapped[str] = mapped_column(String, primary_key=True)
    strategy: Mapped[str] = mapped_column(String, primary_key=True)
    counter: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[str | None] = mapped_column(Text, nullable=True)
