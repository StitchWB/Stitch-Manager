"""
iCloud Hide My Email pool — Pydantic request/response schemas.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


# ── Response ──────────────────────────────────────────────────────────────────

class ICloudPoolEntryResponse(BaseModel):
    """One pool entry as returned to the frontend."""

    model_config = ConfigDict(populate_by_name=True)

    id: int
    email: str
    apple_alias_id: str | None = Field(None, alias="appleAliasId")
    label: str | None = None
    status: str
    apple_id: str | None = Field(None, alias="appleId")
    used_by_account_id: str | None = Field(None, alias="usedByAccountId")
    created_at: str = Field(..., alias="createdAt")
    reserved_at: str | None = Field(None, alias="reservedAt")
    used_at: str | None = Field(None, alias="usedAt")


class ICloudPoolStatsResponse(BaseModel):
    """Pool statistics summary."""

    model_config = ConfigDict(populate_by_name=True)

    total: int
    available: int
    reserved: int
    used: int
    failed: int
    deleted: int
    rate_remaining: int = Field(..., alias="rateRemaining")
    rate_seconds_until_slot: float = Field(..., alias="rateSecondsUntilSlot")


# ── Requests ──────────────────────────────────────────────────────────────────

class FillPoolRequest(BaseModel):
    """Request to generate N more aliases and add them to the pool."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    count: int = Field(5, ge=1, le=5, description="Number of aliases to generate (1-5 per call)")
    label_prefix: str = Field("Auto-registration", alias="labelPrefix")


class ClaimPoolEntryRequest(BaseModel):
    """Internal — claim the next available pool entry (sync, used by bridge)."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class ReleasePoolEntryRequest(BaseModel):
    """Mark a reserved entry as used or failed."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    entry_id: int = Field(..., alias="entryId")
    success: bool = True
    account_id: str | None = Field(None, alias="accountId")


class DeletePoolEntryRequest(BaseModel):
    """Delete an alias both from Apple and the pool table."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    entry_id: int = Field(..., alias="entryId")


class AuthenticateICloudRequest(BaseModel):
    """Trigger iCloud authentication (with optional 2FA code)."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    verification_code: str | None = Field(None, alias="verificationCode")
