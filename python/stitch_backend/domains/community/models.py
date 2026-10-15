"""Models for the community domain.

``FriendItem`` validates entries loaded from ``friends.json``.
``CommunityChannel`` is the local partner-channel catalog store behind
the admin CRUD commands.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base

# ── Enums ────────────────────────────────────────────────────────────────────


class FriendType(StrEnum):
    TELEGRAM = "telegram"
    DISCORD = "discord"
    GITHUB = "github"
    OTHER = "other"


class FriendBadge(StrEnum):
    OFFICIAL = "official"
    PARTNER = "partner"
    FRIEND = "friend"


# ── Models ────────────────────────────────────────────────────────────────────


class FriendItem(BaseModel):
    """A single community friend/channel entry."""

    model_config = ConfigDict(extra="ignore")

    id: str
    type: FriendType
    title: str
    url: str
    description: str | None = None
    badge: FriendBadge | None = None
    logo_url: str | None = None


def _utcnow() -> datetime:
    return datetime.now(UTC)


class CommunityChannel(Base):
    """A local partner-channel catalog row (admin CRUD target)."""

    __tablename__ = "community_channels"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: uuid.uuid4().hex
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String, nullable=True)
    type: Mapped[str] = mapped_column(String, nullable=False, default="telegram")
    badge: Mapped[str | None] = mapped_column(String, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
