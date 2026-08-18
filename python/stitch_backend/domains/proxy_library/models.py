"""Proxy library ORM model.

Stores each proxy entry as a row in ``proxy_library_entries``.
``owner_id`` (nullable FK → ``auth_users.id``) scopes entries to a user;
``NULL`` marks legacy shared entries (editable by anyone, as before).

Secrets (username/password) are stored as encrypted references — the
encryption scheme is unchanged from the legacy JSON-blob era (see
``service._store_secret`` / ``service._load_secret``).
"""

from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base


class ProxyLibraryEntry(Base):
    """Single proxy library entry (ORM row)."""

    __tablename__ = "proxy_library_entries"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("auth_users.id"),
        nullable=True,
        index=True,
        comment="NULL = legacy shared pool (editable by anyone)",
    )
    label: Mapped[str] = mapped_column(String, nullable=False)
    host: Mapped[str] = mapped_column(String, nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    proxy_type: Mapped[str] = mapped_column(String, default="http", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    username: Mapped[str | None] = mapped_column(Text, nullable=True)
    password: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_test_at: Mapped[str | None] = mapped_column(String, nullable=True)
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_test_latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_test_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_test_ip: Mapped[str | None] = mapped_column(String, nullable=True)
    last_test_location: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[str] = mapped_column(String, nullable=False)

    def __repr__(self) -> str:
        return f"<ProxyLibraryEntry id={self.id!r} host={self.host!r} port={self.port}>"
