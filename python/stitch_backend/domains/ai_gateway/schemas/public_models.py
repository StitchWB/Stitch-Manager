"""PublicModel request/response schemas."""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 — pydantic resolves annotations at runtime
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from stitch_backend.domains.ai_gateway.model_identity import is_valid_public_slug
from stitch_backend.domains.ai_gateway.schemas._common import _validate_dict_size

if TYPE_CHECKING:
    from collections.abc import Sequence

    from stitch_backend.domains.ai_gateway.models import PublicModel, RouteTarget


class PublicModelCreateRequest(BaseModel):
    """Request body for ``create_public_model``. ``id`` is a user-chosen slug."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str = Field(max_length=200)
    display_name: str | None = Field(None, alias="displayName", max_length=200)
    enabled: bool = True
    contract: dict[str, Any] | None = None

    @field_validator("id")
    @classmethod
    def validate_id(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("id must not be empty")
        if not is_valid_public_slug(v):
            raise ValueError(
                "id may only contain alphanumeric characters, hyphens, "
                "underscores, dots, and non-empty slash-separated segments"
            )
        return v

    @field_validator("contract")
    @classmethod
    def validate_contract(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_dict_size(v, "contract")


class PublicModelUpdateRequest(BaseModel):
    """Request body for ``update_public_model``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str
    display_name: str | None = Field(None, alias="displayName")
    enabled: bool | None = None
    contract: dict[str, Any] | None = None


class PublicModelIdRequest(BaseModel):
    """Request body for ``get_public_model`` / ``delete_public_model``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str


class ListPublicModelsRequest(BaseModel):
    """Request body for ``list_public_models``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class MergePublicModelsRequest(BaseModel):
    """Request body for ``merge_public_models`` — fold ``source_id`` into ``target_id``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    source_id: str = Field(alias="sourceId")
    target_id: str = Field(alias="targetId")


class UnmergeRouteTargetRequest(BaseModel):
    """Request body for ``unmerge_route_target`` — split one target into its own public model."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    target_id: int = Field(alias="targetId")
    new_public_model_id: str = Field(alias="newPublicModelId", max_length=200)

    @field_validator("new_public_model_id")
    @classmethod
    def validate_new_public_model_id(cls, v: str) -> str:
        return PublicModelCreateRequest.validate_id(v)


class PublicModelRouteTarget(BaseModel):
    """Route target embedded in :class:`PublicModelResponse`."""

    model_config = ConfigDict(populate_by_name=True)

    id: int
    upstream_model_id: str = Field(alias="upstreamModelId")
    provider_endpoint_id: str = Field(alias="providerEndpointId")
    enabled: bool
    priority: int
    weight: float
    cost_modifier: float = Field(alias="costModifier")

    @classmethod
    def from_parts(
        cls, target: RouteTarget, provider_endpoint_id: str,
    ) -> PublicModelRouteTarget:
        return cls(
            id=target.id,
            upstream_model_id=target.upstream_model_id,
            provider_endpoint_id=provider_endpoint_id,
            enabled=target.enabled,
            priority=target.priority,
            weight=target.weight,
            cost_modifier=target.cost_modifier,
        )


class PublicModelResponse(BaseModel):
    """Wire DTO for :class:`PublicModel`."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    display_name: str | None = Field(None, alias="displayName")
    enabled: bool
    contract: dict[str, Any] | None = None
    owner_id: int | None = Field(None, alias="ownerId")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")
    route_targets: list[PublicModelRouteTarget] = Field(
        default_factory=list, alias="routeTargets",
    )

    @classmethod
    def from_orm_model(
        cls,
        obj: PublicModel,
        route_targets: Sequence[PublicModelRouteTarget] | None = None,
    ) -> PublicModelResponse:
        return cls(
            id=obj.id,
            display_name=obj.display_name,
            enabled=obj.enabled,
            contract=obj.contract,
            owner_id=obj.owner_id,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
            route_targets=list(route_targets or []),
        )
