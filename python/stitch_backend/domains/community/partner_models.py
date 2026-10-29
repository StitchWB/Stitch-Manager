"""ORM models for partner-channel membership (Feature 1).

``partner_members`` links ``auth_users`` to a partner channel for the web
UI panel.  ``channel_id`` references the distribution server's
``ss_partner_channels.id`` — deliberately NOT a FK (the channel table lives
on the server; the backend never joins across processes).
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class PartnerMember(Base):
    """A user who activated via a partner-channel invite code."""

    __tablename__ = "partner_members"

    channel_id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("auth_users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    invited_by_tg_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    granted_role: Mapped[str] = mapped_column(String, nullable=False, default="user")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
