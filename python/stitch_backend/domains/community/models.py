"""Pydantic models for the community domain.

``FriendItem`` validates entries loaded from ``friends.json``.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict

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
