"""PublicModel request/response schemas."""

from __future__ import annotations

import re
from datetime import datetime  # noqa: TC003 — pydantic resolves annotations at runtime
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from stitch_backend.domains.ai_gateway.schemas._common import _validate_dict_size

if TYPE_CHECKING:
    from stitch_backend.domains.ai_gateway.models import PublicModel


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
        if not re.fullmatch(r"[A-Za-z0-9._-]+", v):
            raise ValueError(
                "id may only contain alphanumeric characters, hyphens, "
                "underscores, and dots"
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


class PublicModelResponse(BaseModel):
    """Wire DTO for :class:`PublicModel`."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    display_name: str | None = Field(None, alias="displayName")
    enabled: bool
    contract: dict[str, Any] | None = None
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")

    @classmethod
    def from_orm_model(cls, obj: PublicModel) -> PublicModelResponse:
        return cls(
            id=obj.id,
            display_name=obj.display_name,
            enabled=obj.enabled,
            contract=obj.contract,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )
