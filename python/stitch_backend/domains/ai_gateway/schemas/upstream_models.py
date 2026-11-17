"""UpstreamModel request/response schemas."""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 — pydantic resolves annotations at runtime
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from stitch_backend.domains.ai_gateway.schemas._common import _validate_dict_size

if TYPE_CHECKING:
    from stitch_backend.domains.ai_gateway.models import UpstreamModel


class UpstreamModelCreateRequest(BaseModel):
    """Request body for ``create_upstream_model``.

    Handled via the idempotent ``UpstreamModelService.upsert_model`` —
    calling this command twice with the same
    ``(providerEndpointId, upstreamModelId)`` updates in place.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider_endpoint_id: str = Field(alias="providerEndpointId")
    upstream_model_id: str = Field(alias="upstreamModelId", max_length=500)
    display_name: str | None = Field(None, alias="displayName", max_length=200)
    enabled: bool = True
    discovery_source: str = Field("manual", alias="discoverySource")
    capabilities: dict[str, Any] | None = None

    @field_validator("upstream_model_id")
    @classmethod
    def validate_upstream_model_id(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("upstream_model_id must not be empty")
        return v

    @field_validator("capabilities")
    @classmethod
    def validate_capabilities(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_dict_size(v, "capabilities")


class UpstreamModelUpdateRequest(BaseModel):
    """Request body for ``update_upstream_model``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str
    display_name: str | None = Field(None, alias="displayName")
    enabled: bool | None = None
    discovery_source: str | None = Field(None, alias="discoverySource")
    capabilities: dict[str, Any] | None = None
    selection_source: str | None = Field(None, alias="selectionSource")

    @field_validator("selection_source")
    @classmethod
    def validate_selection_source(cls, v: str | None) -> str | None:
        allowed = {"auto", "manual_allow", "manual_deny"}
        if v is not None and v not in allowed:
            raise ValueError(f"selectionSource must be one of {sorted(allowed)}")
        return v

    @field_validator("capabilities")
    @classmethod
    def validate_capabilities(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is not None:
            return UpstreamModelCreateRequest.validate_capabilities(v)
        return v


class UpstreamModelIdRequest(BaseModel):
    """Request body for ``get_upstream_model`` / ``delete_upstream_model``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str


class ListUpstreamModelsRequest(BaseModel):
    """Request body for ``list_upstream_models``.

    ``limit=0`` means unlimited, and every filter is ``None`` by default, so
    an empty body returns the same unfiltered, untruncated row set.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider_endpoint_id: str | None = Field(None, alias="providerEndpointId")
    q: str | None = None
    alive_within_minutes: int | None = Field(None, alias="aliveWithinMinutes", ge=0)
    enabled: bool | None = None
    order_by: Literal["last_seen", "id", "display_name"] = Field(
        "last_seen", alias="orderBy",
    )
    limit: int = Field(0, ge=0)
    offset: int = Field(0, ge=0)


class UpstreamModelResponse(BaseModel):
    """Wire DTO for :class:`UpstreamModel`."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    provider_endpoint_id: str = Field(alias="providerEndpointId")
    upstream_model_id: str = Field(alias="upstreamModelId")
    display_name: str | None = Field(None, alias="displayName")
    enabled: bool
    discovery_source: str = Field(alias="discoverySource")
    canonical_model_key: str | None = Field(None, alias="canonicalModelKey")
    last_discovered_at: datetime | None = Field(None, alias="lastDiscoveredAt")
    last_seen_at: datetime | None = Field(None, alias="lastSeenAt")
    selection_source: str = Field("auto", alias="selectionSource")
    capabilities: dict[str, Any] | None = None
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")

    @classmethod
    def from_orm_model(cls, obj: UpstreamModel) -> UpstreamModelResponse:
        return cls(
            id=obj.id,
            provider_endpoint_id=obj.provider_endpoint_id,
            upstream_model_id=obj.upstream_model_id,
            display_name=obj.display_name,
            enabled=obj.enabled,
            discovery_source=obj.discovery_source,
            canonical_model_key=obj.canonical_model_key,
            last_discovered_at=obj.last_discovered_at,
            last_seen_at=obj.last_seen_at,
            selection_source=obj.selection_source or "auto",
            capabilities=obj.capabilities,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )


class UpstreamModelListResponse(BaseModel):
    """Response for ``list_upstream_models``.

    ``total`` counts every matching row, i.e. before ``limit``/``offset``.
    """

    model_config = ConfigDict(populate_by_name=True)

    models: list[UpstreamModelResponse]
    total: int
