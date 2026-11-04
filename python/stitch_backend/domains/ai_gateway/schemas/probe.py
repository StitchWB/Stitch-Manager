"""Request schema for the generic ``probe_endpoint`` command."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProbeEndpointRequest(BaseModel):
    """Request body for ``probe_endpoint``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    base_url: str = Field(alias="baseUrl", max_length=2000)
    api_key: str | None = Field(None, alias="apiKey")
    model: str | None = None
    prompt: str | None = None
    image_url: str | None = Field(None, alias="imageUrl")
    timeout_seconds: float = Field(20.0, alias="timeoutSeconds", gt=0)

    @field_validator("base_url")
    @classmethod
    def _normalize_base_url(cls, v: str) -> str:
        v = v.strip().rstrip("/")
        if not v.startswith(("http://", "https://")):
            raise ValueError("baseUrl must start with http:// or https://")
        return v
