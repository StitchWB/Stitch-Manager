"""CredentialModelAccess request/response schemas."""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 — pydantic resolves annotations at runtime
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, field_validator

if TYPE_CHECKING:
    from stitch_backend.domains.ai_gateway.models import CredentialModelAccess


class CredentialModelAccessUpsertRequest(BaseModel):
    """Request body for ``upsert_credential_model_access``.

    Idempotent by the ``(credentialId, upstreamModelId)`` unique constraint.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    credential_id: str = Field(alias="credentialId")
    upstream_model_id: str = Field(alias="upstreamModelId")
    status: str = "unknown"
    last_error: str | None = Field(None, alias="lastError")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        allowed = {"unknown", "available", "unavailable"}
        if v not in allowed:
            raise ValueError(f"status must be one of {allowed}")
        return v

    @field_validator("last_error")
    @classmethod
    def validate_last_error(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 2000:
            raise ValueError("last_error must be <= 2000 characters")
        return v


class ListCredentialModelAccessRequest(BaseModel):
    """Request body for ``list_credential_model_access``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    credential_id: str | None = Field(None, alias="credentialId")
    upstream_model_id: str | None = Field(None, alias="upstreamModelId")


class CredentialModelAccessIdRequest(BaseModel):
    """Request body for ``delete_credential_model_access``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: int


class CredentialModelAccessResponse(BaseModel):
    """Wire DTO for :class:`CredentialModelAccess`."""

    model_config = ConfigDict(populate_by_name=True)

    id: int
    credential_id: str = Field(alias="credentialId")
    upstream_model_id: str = Field(alias="upstreamModelId")
    status: str
    last_verified_at: datetime | None = Field(None, alias="lastVerifiedAt")
    last_error: str | None = Field(None, alias="lastError")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")

    @classmethod
    def from_orm_model(cls, obj: CredentialModelAccess) -> CredentialModelAccessResponse:
        return cls(
            id=obj.id,
            credential_id=obj.credential_id,
            upstream_model_id=obj.upstream_model_id,
            status=obj.status,
            last_verified_at=obj.last_verified_at,
            last_error=obj.last_error,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )
