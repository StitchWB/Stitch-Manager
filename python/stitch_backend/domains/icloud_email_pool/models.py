"""
iCloud Hide My Email pool — SQLAlchemy ORM models.

Table ``icloud_email_pool`` stores pre-generated Hide My Email aliases.
Each row represents one alias with its current lifecycle status.

Statuses:
  available  — ready to be claimed by a registration job
  reserved   — claimed but registration not yet confirmed
  used       — successfully used for an account
  failed     — alias was used but registration failed; can be recycled
  deleted    — deactivated on Apple's side; cannot be used
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class ICloudEmailPoolEntry(Base):
    """One Hide My Email alias in the pool."""

    __tablename__ = "icloud_email_pool"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # The generated alias, e.g. abc123xyz@privaterelay.appleid.com
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)

    # Apple's anonymousId for the alias (used to delete/deactivate it)
    apple_alias_id: Mapped[str | None] = mapped_column(String, index=True)

    # Human-readable label set at generation time
    label: Mapped[str | None] = mapped_column(String)

    # available | reserved | used | failed | deleted
    status: Mapped[str] = mapped_column(String, default="available", index=True)

    # Which Apple ID account generated this alias
    apple_id: Mapped[str | None] = mapped_column(String, index=True)

    # FK to accounts.id when the alias was used for a registration
    used_by_account_id: Mapped[str | None] = mapped_column(String)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    reserved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def __repr__(self) -> str:
        return (
            f"<ICloudEmailPoolEntry id={self.id} email={self.email!r}"
            f" status={self.status!r}>"
        )
