"""App logs ORM model — maps to the ``app_logs`` table.

Schema::

    CREATE TABLE app_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL CHECK(level IN ('debug','info','success','warn','error')),
        channel TEXT NOT NULL DEFAULT 'app',
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        correlation_id TEXT,
        session_id TEXT,
        context_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
"""

from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base


class AppLog(Base):
    """Persisted application log entry."""

    __tablename__ = "app_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    timestamp: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    level: Mapped[str] = mapped_column(String, nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String, nullable=False, default="app")
    source: Mapped[str] = mapped_column(String, nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    context_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str | None] = mapped_column(Text, nullable=True)
