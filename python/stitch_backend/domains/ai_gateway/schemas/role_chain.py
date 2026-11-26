"""Role-chain desired-state command schemas."""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 — pydantic resolves annotations at runtime
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, field_validator

from stitch_backend.domains.ai_gateway.model_identity import is_valid_public_slug

if TYPE_CHECKING:
    from stitch_backend.domains.ai_gateway.models import RoleChainEntry


def _validate_public_model_id(value: str) -> str:
    value = value.strip()
    if not is_valid_public_slug(value):
        raise ValueError("publicModelId must be a valid public model slug")
    return value


def _validate_non_empty(value: str, field_name: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError(f"{field_name} must not be empty")
    return value


class ListRoleChainEntriesRequest(BaseModel):
    """Request body for ``list_role_chain_entries``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    public_model_id: str | None = Field(None, alias="publicModelId")
    endpoint_selector: str | None = Field(None, alias="endpointSelector")

    @field_validator("public_model_id")
    @classmethod
    def validate_public_model_id(cls, v: str | None) -> str | None:
        return None if v is None else _validate_public_model_id(v)


class UpsertRoleChainEntryRequest(BaseModel):
    """Request body for ``upsert_role_chain_entry``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    public_model_id: str = Field(alias="publicModelId", max_length=200)
    upstream_model_key: str = Field(alias="upstreamModelKey", max_length=300)
    endpoint_selector: str = Field("reformboss", alias="endpointSelector", max_length=100)
    family: str | None = Field(None, max_length=100)
    ordinal: int = Field(default=0, ge=0)
    enabled: bool = True

    @field_validator("public_model_id")
    @classmethod
    def validate_public_model_id(cls, v: str) -> str:
        return _validate_public_model_id(v)

    @field_validator("upstream_model_key")
    @classmethod
    def validate_upstream_model_key(cls, v: str) -> str:
        return _validate_non_empty(v, "upstreamModelKey")

    @field_validator("endpoint_selector")
    @classmethod
    def validate_endpoint_selector(cls, v: str) -> str:
        return _validate_non_empty(v, "endpointSelector")


class RoleChainEntryIdRequest(BaseModel):
    """Request body for entry-id role-chain commands."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str


class RoleChainEntryResponse(BaseModel):
    """Wire DTO for one desired role-chain entry."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    public_model_id: str = Field(alias="publicModelId")
    endpoint_selector: str = Field(alias="endpointSelector")
    upstream_model_key: str = Field(alias="upstreamModelKey")
    family: str | None = None
    ordinal: int
    enabled: bool
    source: str
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")

    @classmethod
    def from_orm_model(cls, obj: RoleChainEntry) -> RoleChainEntryResponse:
        return cls(
            id=obj.id,
            public_model_id=obj.public_model_id,
            endpoint_selector=obj.endpoint_selector,
            upstream_model_key=obj.upstream_model_key,
            family=obj.family,
            ordinal=obj.ordinal,
            enabled=obj.enabled,
            source=obj.source,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )
