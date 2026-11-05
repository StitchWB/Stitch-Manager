"""Request schema for the batch ``probe_endpoint_models`` command."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProbeEndpointModelsRequest(BaseModel):
    """Request body for ``probe_endpoint_models``.

    Target resolution order: ``credentialId`` → ``endpointId`` → raw
    ``baseUrl`` (+ optional ``apiKey``); at least one is required. The secret
    never travels back: it is resolved from the credential store and only used
    to sign the probe requests.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    credential_id: str | None = Field(None, alias="credentialId")
    endpoint_id: str | None = Field(None, alias="endpointId")
    base_url: str | None = Field(None, alias="baseUrl")
    api_key: str | None = Field(None, alias="apiKey")
    adapter_type: str | None = Field(None, alias="adapterType")
    models: list[str] | None = None
    filter_prefix: str | None = Field(None, alias="filterPrefix")
    limit: int = Field(50, ge=0)
    concurrency: int = Field(8, ge=1, le=64)
    max_tokens: int = Field(32, alias="maxTokens", ge=1, le=1024)
    prompt: str | None = None
    include_multimodal: bool = Field(False, alias="includeMultimodal")
    vision_models: list[str] | None = Field(None, alias="visionModels")
    budget_seconds: float = Field(120.0, alias="budgetSeconds", gt=0)

    @model_validator(mode="after")
    def _require_target(self) -> ProbeEndpointModelsRequest:
        if not (self.credential_id or self.endpoint_id or self.base_url):
            raise ValueError("one of credentialId, endpointId or baseUrl is required")
        return self
