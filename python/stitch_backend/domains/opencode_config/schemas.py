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


class OpenCodeModelsReportRequest(BaseModel):
    """Request body for ``opencode_models_report``.

    ``provider`` resolves baseURL/apiKey from the opencode config; an explicit
    ``baseUrl``/``apiKey`` overrides it. ``limit`` caps how many models get a
    live probe; ``limit=0`` returns the catalog only.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider: str | None = None
    base_url: str | None = Field(None, alias="baseUrl")
    api_key: str | None = Field(None, alias="apiKey")
    mode: Literal["catalog", "probe"] = "catalog"
    limit: int = Field(50, ge=0)
    concurrency: int = Field(8, ge=1, le=64)
    timeout_seconds: float = Field(20.0, alias="timeoutSeconds", gt=0)
    budget_seconds: float = Field(120.0, alias="budgetSeconds", gt=0)
    vision_shortlist: list[str] | None = Field(None, alias="visionShortlist")
    prompt: str | None = None
    opencode_path: str | None = Field(None, alias="opencodePath")


class ProviderBalanceRequest(BaseModel):
    """Request body for ``provider_balance``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider: str | None = None
    base_url: str | None = Field(None, alias="baseUrl")
    api_key: str | None = Field(None, alias="apiKey")
    timeout_seconds: float = Field(20.0, alias="timeoutSeconds", gt=0)
    opencode_path: str | None = Field(None, alias="opencodePath")


class OpenCodeModelsReconcileRequest(BaseModel):
    """Request body for ``opencode_models_reconcile``.

    Dry-run by default: it reports ``toAdd``/``toRemove`` and only writes when
    ``apply`` is true.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider: str
    base_url: str | None = Field(None, alias="baseUrl")
    api_key: str | None = Field(None, alias="apiKey")
    apply: bool = False
    prune: bool = True
    timeout_seconds: float = Field(20.0, alias="timeoutSeconds", gt=0)
    opencode_path: str | None = Field(None, alias="opencodePath")
