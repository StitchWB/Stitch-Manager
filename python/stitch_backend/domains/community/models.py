"""Pydantic models for the community domain.

``FriendItem`` validates entries loaded from ``friends.json``.
``RadarOffersParams`` validates and whitelists query parameters before
they are forwarded to the upstream AiApiRadar API — unknown fields are
silently dropped (never proxied).
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, model_validator

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


class RadarSort(StrEnum):
    NEW = "new"
    AMOUNT = "amount"


class RadarEffort(StrEnum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


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


class RadarOffersParams(BaseModel):
    """Validated + whitelisted query params for ``GET /api/offers``.

    Only fields defined here are forwarded to the upstream API.  ``limit``
    is clamped to ``1..500``; ``sort`` and ``effort`` are enum-validated.
    """

    model_config = ConfigDict(extra="ignore")

    limit: int = 50
    offset: int = 0
    sort: RadarSort | None = None
    type: str | None = None
    effort: RadarEffort | None = None
    status: str | None = None
    q: str | None = None
    since_hours: int | None = None

    @model_validator(mode="after")
    def _clamp_limit(self) -> RadarOffersParams:
        if self.limit < 1:
            self.limit = 1
        elif self.limit > 500:
            self.limit = 500
        return self

    def to_query(self) -> dict[str, str]:
        """Return non-None fields as a string dict for httpx ``params``."""
        return {
            k: str(v)
            for k, v in self.model_dump(mode="json").items()
            if v is not None
        }
