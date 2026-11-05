"""Request schemas for the opencode_config commands."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class OpenCodeConfigGetRequest(BaseModel):
    """Request body for ``opencode_config_get``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    opencode_path: str | None = Field(None, alias="opencodePath")
    omo_path: str | None = Field(None, alias="omoPath")


class OpenCodeProviderUpsertRequest(BaseModel):
    """Request body for ``opencode_provider_upsert``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str
    name: str
    npm: str
    base_url: str = Field(alias="baseURL")
    api_key: str | None = Field(None, alias="apiKey")
    headers: dict[str, str] | None = None
    models: dict[str, Any] | list[str] | None = None
    opencode_path: str | None = Field(None, alias="opencodePath")


class OpenCodeAgentAssignRequest(BaseModel):
    """Request body for ``opencode_agent_assign``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    agent: str
    model: str
    fallback_models: list[str] | None = Field(None, alias="fallbackModels")
    target: Literal["auto", "opencode", "omo"] = "auto"
    opencode_path: str | None = Field(None, alias="opencodePath")
    omo_path: str | None = Field(None, alias="omoPath")
