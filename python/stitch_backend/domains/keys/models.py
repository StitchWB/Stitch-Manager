"""Pydantic models for the found-keys proxy commands."""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class FoundKeysParams(BaseModel):
    """Query params for ``GET /api/found-keys`` (radar side)."""

    provider: str | None = None
    tier: str | None = None
    status: str | None = None
    platform: str | None = None
    verify: str | None = None  # verify_status filter, e.g. "live"
    limit: int = 50
    offset: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _clamp_limit(self) -> FoundKeysParams:
        # silent clamp 1..500, matching the radar contract and the
        # community domain house pattern (review finding: hard-reject
        # at 200 drifted from both)
        self.limit = min(max(self.limit, 1), 500)
        return self

    def to_query(self) -> dict[str, str]:
        q: dict[str, str] = {"limit": str(self.limit), "offset": str(self.offset)}
        if self.provider:
            q["provider"] = self.provider
        if self.tier:
            q["tier"] = self.tier
        if self.status:
            q["status"] = self.status
        if self.platform:
            q["platform"] = self.platform
        if self.verify:
            q["verify"] = self.verify
        return q


class FoundKeySecretParams(BaseModel):
    """Params for ``GET /api/found-keys/{id}/secret`` (radar side)."""

    id: int
