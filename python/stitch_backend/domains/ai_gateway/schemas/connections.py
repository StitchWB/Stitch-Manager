"""Unified connection save schemas (endpoint + credentials in one request)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from stitch_backend.domains.ai_gateway.schemas.credentials import (
    CredentialResponse,  # noqa: TC001 — pydantic resolves annotations at runtime
)
from stitch_backend.domains.ai_gateway.schemas.endpoints import (
    ProviderEndpointCreateRequest,
    ProviderEndpointResponse,
)

_MAX_SECRETS_PER_SAVE = 200
_MAX_SECRET_LEN = 4096


class SaveConnectionAuth(BaseModel):
    """Auth block of ``save_connection``.

    ``type="none"`` is scoped to adapters that genuinely serve unauthenticated
    requests (``openai_compatible`` local servers); it is represented by a
    marker credential with NO ``CredentialSecret`` row.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    type: Literal["api_key", "none"]
    secrets: list[str] | None = None

    @field_validator("secrets")
    @classmethod
    def validate_secrets(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        if len(v) > _MAX_SECRETS_PER_SAVE:
            raise ValueError(
                f"at most {_MAX_SECRETS_PER_SAVE} secrets per save_connection call"
            )
        cleaned: list[str] = []
        seen: set[str] = set()
        for raw in v:
            if not isinstance(raw, str):
                raise ValueError("each secret must be a string")
            if any(ord(char) < 32 or ord(char) == 127 for char in raw):
                raise ValueError("API keys must not contain control characters")
            secret = raw.strip()
            if not secret:
                raise ValueError("secrets must not contain empty values")
            if len(secret) > _MAX_SECRET_LEN:
                raise ValueError(f"secret exceeds {_MAX_SECRET_LEN} chars")
            if secret not in seen:
                seen.add(secret)
                cleaned.append(secret)
        return cleaned

    @model_validator(mode="after")
    def check_secrets_for_type(self) -> SaveConnectionAuth:
        if self.type == "api_key" and not self.secrets:
            raise ValueError("auth.type 'api_key' requires at least one secret")
        if self.type == "none" and self.secrets:
            raise ValueError("auth.type 'none' must not carry secrets")
        return self


class SaveConnectionRequest(BaseModel):
    """Request body for ``save_connection``.

    Two modes:
      - NEW connection (``endpoint_id`` absent): ``name``, ``adapter_type``
        and ``base_url`` are required; the endpoint is matched against the
        caller's visible rows by normalized URL + protocol, or created.
      - EXISTING endpoint (``endpoint_id`` present): only keys are added;
        the endpoint row is never mutated (name/baseUrl/defaultHeaders/
        enabled submissions are ignored).
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    endpoint_id: str | None = Field(None, alias="endpointId")
    name: str | None = Field(None, max_length=200)
    adapter_type: str | None = Field(None, alias="adapterType")
    base_url: str | None = Field(None, alias="baseUrl", max_length=2000)
    enabled: bool | None = None
    default_headers: dict[str, Any] | None = Field(None, alias="defaultHeaders")
    auth: SaveConnectionAuth

    @model_validator(mode="after")
    def check_new_connection_fields(self) -> SaveConnectionRequest:
        if self.endpoint_id is not None:
            return self
        missing = [
            alias for field, alias in (
                (self.name, "name"),
                (self.adapter_type, "adapterType"),
                (self.base_url, "baseUrl"),
            ) if not field
        ]
        if missing:
            raise ValueError(f"new connection requires: {', '.join(missing)}")
        return self

    @field_validator("adapter_type")
    @classmethod
    def validate_adapter_type(cls, v: str | None) -> str | None:
        if v is not None:
            return ProviderEndpointCreateRequest.validate_adapter_type(v)
        return v

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, v: str | None) -> str | None:
        # SSRF policy invariant: identical to endpoint creation, never weaker.
        if v is not None:
            return ProviderEndpointCreateRequest.validate_base_url(v)
        return v

    @field_validator("default_headers")
    @classmethod
    def validate_default_headers(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is not None:
            return ProviderEndpointCreateRequest.validate_default_headers(v)
        return v


class SaveConnectionResponse(BaseModel):
    """Wire DTO for ``save_connection`` — never carries submitted secrets."""

    model_config = ConfigDict(populate_by_name=True)

    endpoint: ProviderEndpointResponse
    endpoint_created: bool = Field(alias="endpointCreated")
    credentials: list[CredentialResponse]
    credentials_created: int = Field(alias="credentialsCreated")
    credentials_existing: int = Field(alias="credentialsExisting")


class AdapterCapabilitiesResponse(BaseModel):
    """Wire DTO for ``get_adapter_capabilities``."""

    model_config = ConfigDict(populate_by_name=True)

    adapter_type: str = Field(alias="adapterType")
    supports_none_auth: bool = Field(alias="supportsNoneAuth")
    supports_chat: bool = Field(alias="supportsChat")
    supports_responses: bool = Field(alias="supportsResponses")
    supports_model_discovery: bool = Field(alias="supportsModelDiscovery")
    limitations: list[str] = Field(default_factory=list)
