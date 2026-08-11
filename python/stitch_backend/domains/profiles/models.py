"""Profile Settings ORM model — versioned browser profile configuration.

Stores per-alias browser profile settings (network, geo, hardware, storage)
as JSON in SQLite.  Complements file-based fingerprint profiles.

Table schema (migration 016):
  - alias:       TEXT PK
  - config_json: TEXT NOT NULL  (versioned JSON blob)
  - cookies:     TEXT NULL
  - notes:       TEXT NULL
  - updated_at:  TEXT DEFAULT datetime('now')
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class ProfileSettings(Base):
    """Versioned browser profile settings stored in SQLite.

    The ``config_json`` field holds a serialised ``ProfileSettingsV1`` blob.
    Cookies and notes are stored both inside JSON and as dedicated columns
    for convenient access.
    """

    __tablename__ = "profile_settings"

    alias: Mapped[str] = mapped_column(
        String, primary_key=True, comment="Browser profile alias (email or label)"
    )
    config_json: Mapped[str] = mapped_column(
        Text, nullable=False, comment="Versioned settings JSON (ProfileSettingsV1)"
    )
    cookies: Mapped[str | None] = mapped_column(
        Text, comment="Serialised cookies for session persistence"
    )
    notes: Mapped[str | None] = mapped_column(
        Text, comment="Free-form user notes for this profile"
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    def __repr__(self) -> str:
        return f"<ProfileSettings alias={self.alias!r}>"
