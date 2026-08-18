"""Email Inbox ORM models — profiles and sync state tables.

Schema (migration ``019_email_inbox_profiles.sql``)::

    email_inbox_profiles:
        id, label, provider, account_id, connect_input_json, owner_id, created_at, updated_at

    email_inbox_sync_states:
        profile_id (FK→profiles), status, last_sync_at, last_error, cursor, updated_at
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base
from stitch_backend.security.fernet_at_rest import EncryptedText


class EmailInboxProfile(Base):
    """Saved IMAP / MailTm connection profile."""

    __tablename__ = "email_inbox_profiles"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    account_id: Mapped[str] = mapped_column(String, nullable=False)
    # Encrypted at rest: legacy plaintext rows are tolerated on read
    # (EncryptedText returns them as-is) and re-encrypted on the next
    # startup via migrate_plaintext_to_encrypted in main.py lifespan.
    connect_input_json: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    owner_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="NULL = shared pool (legacy, visible to all callers)",
    )
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        Index("idx_email_inbox_profiles_provider", "provider"),
        Index("idx_email_inbox_profiles_account_id", "account_id"),
    )


class EmailInboxSyncState(Base):
    """Per-profile sync cursor and status."""

    __tablename__ = "email_inbox_sync_states"

    profile_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("email_inbox_profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    status: Mapped[str] = mapped_column(String, nullable=False)
    last_sync_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    cursor: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)
