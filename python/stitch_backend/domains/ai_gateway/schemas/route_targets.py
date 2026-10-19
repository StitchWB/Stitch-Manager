"""RouteTarget request/response schemas."""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 — pydantic resolves annotations at runtime
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from stitch_backend.domains.ai_gateway.models import RouteTarget


class RouteTargetCreateRequest(BaseModel):
    """Request body for ``create_route_target``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    public_model_id: str = Field(alias="publicModelId")
    upstream_model_id: str = Field(alias="upstreamModelId")
    enabled: bool = True
    priority: int = Field(default=100, ge=0)
    weight: float = Field(default=1.0, ge=0)
    cost_modifier: float = Field(default=1.0, alias="costModifier", ge=0)


class RouteTargetUpdateRequest(BaseModel):
    """Request body for ``update_route_target``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: int
    enabled: bool | None = None
    priority: int | None = Field(default=None, ge=0)
    weight: float | None = Field(default=None, ge=0)
    cost_modifier: float | None = Field(default=None, alias="costModifier", ge=0)


class RouteTargetIdRequest(BaseModel):
    """Request body for ``delete_route_target``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: int


class ListRouteTargetsForPublicModelRequest(BaseModel):
    """Request body for ``list_route_targets_for_public_model``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    public_model_id: str = Field(alias="publicModelId")


class RouteTargetResponse(BaseModel):
    """Wire DTO for :class:`RouteTarget`."""

    model_config = ConfigDict(populate_by_name=True)

    id: int
    public_model_id: str = Field(alias="publicModelId")
    upstream_model_id: str = Field(alias="upstreamModelId")
    enabled: bool
    priority: int
    weight: float
    cost_modifier: float = Field(alias="costModifier")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")

    @classmethod
    def from_orm_model(cls, obj: RouteTarget) -> RouteTargetResponse:
        return cls(
            id=obj.id,
            public_model_id=obj.public_model_id,
            upstream_model_id=obj.upstream_model_id,
            enabled=obj.enabled,
            priority=obj.priority,
            weight=obj.weight,
            cost_modifier=obj.cost_modifier,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )
