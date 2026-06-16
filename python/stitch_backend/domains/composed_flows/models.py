"""Composed flows ORM model.

Matches Rust migration 018_composed_flows.sql::

    CREATE TABLE composed_flows (
      id TEXT PRIMARY KEY,
      alias TEXT NOT NULL,
      name TEXT NOT NULL,
      flow_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_run_at INTEGER NULL,
      run_count INTEGER NOT NULL DEFAULT 0
    )
"""

from __future__ import annotations

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base


class ComposedFlow(Base):
    """A saved composed flow (scenario chain)."""

    __tablename__ = "composed_flows"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    alias: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    flow_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)
    last_run_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    run_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
