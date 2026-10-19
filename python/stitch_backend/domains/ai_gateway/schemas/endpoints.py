"""ProviderEndpoint request/response schemas."""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 — pydantic resolves annotations at runtime
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from stitch_backend.domains.ai_gateway.schemas._common import _validate_dict_size

if TYPE_CHECKING:
    from stitch_backend.domains.ai_gateway.models import ProviderEndpoint

_VALID_ADAPTER_TYPES = {"openai_compatible", "anthropic", "gemini"}

# Transport-controlled or security-sensitive headers — setting them would spoof identity or break routing.
_BLOCKED_HEADERS = frozenset({
    "host", "x-forwarded-for", "x-real-ip", "content-length",
    "transfer-encoding", "connection", "authorization",
})

# Cap on a single default_header value — guards header injection (newlines) and unbounded storage.
_MAX_HEADER_VALUE_LEN = 2000


class ProviderEndpointCreateRequest(BaseModel):
    """Request body for ``create_provider_endpoint``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    name: str = Field(max_length=200)
    adapter_type: str = Field(alias="adapterType")
    base_url: str = Field(alias="baseUrl", max_length=2000)
    enabled: bool = True
    default_headers: dict[str, Any] | None = Field(None, alias="defaultHeaders")
    discovery_policy: dict[str, Any] | None = Field(None, alias="discoveryPolicy")
    health_policy: dict[str, Any] | None = Field(None, alias="healthPolicy")

    @field_validator("adapter_type")
    @classmethod
    def validate_adapter_type(cls, v: str) -> str:
        if v not in _VALID_ADAPTER_TYPES:
            raise ValueError(
                f"Invalid adapter_type: {v!r}. "
                f"Valid values: {sorted(_VALID_ADAPTER_TYPES)}"
            )
        return v

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, v: str) -> str:
        v = v.strip()
        # ponytail: prefix check is the SSRF guard — HTTPS anywhere, HTTP only to loopback.
        if not v.startswith(("https://", "http://localhost", "http://127.0.0.1")):
            raise ValueError(
                "base_url must start with 'https://', 'http://localhost', or "
                "'http://127.0.0.1'"
            )
        parsed = urlparse(v)
        if not parsed.hostname:
            raise ValueError("base_url must contain a hostname")
        # ponytail: prevent http://localhost.evil.com bypassing the loopback-only rule.
        if parsed.scheme.lower() == "http" and parsed.hostname.lower() not in (
            "localhost",
            "127.0.0.1",
        ):
            raise ValueError(
                "http:// base_url is only allowed for localhost or 127.0.0.1; "
                "use https:// for other hosts"
            )

        # SSRF guard: resolve DNS and block private/reserved IPs (anti-rebinding); ponytail: add allowlist for dev/test.
        if parsed.scheme.lower() == "https":
            try:
                import ipaddress
                import socket

                addrinfos = socket.getaddrinfo(parsed.hostname, None)
                for addrinfo in addrinfos:
                    ip_str = addrinfo[4][0]
                    ip = ipaddress.ip_address(ip_str)

                    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                        raise ValueError(
                            f"base_url resolves to private/reserved IP {ip} — "
                            "HTTPS to internal networks is blocked to prevent SSRF"
                        )
            except (socket.gaierror, ValueError) as e:
                if "private/reserved IP" in str(e):
                    raise
                # DNS resolution failed — block it to be safe
                raise ValueError(f"base_url hostname could not be resolved: {parsed.hostname}") from None

        return v.rstrip("/")

    @field_validator("default_headers")
    @classmethod
    def validate_default_headers(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is None:
            return v
        for key, value in v.items():
            if key.lower() in _BLOCKED_HEADERS:
                raise ValueError(f"Header {key!r} is not allowed in default_headers")
            # Header-injection guard: reject CR/LF and bound value length against smuggled headers or unbounded blobs.
            if isinstance(value, str):
                if "\r" in value or "\n" in value:
                    raise ValueError(
                        f"Header {key!r} value must not contain CR or LF"
                    )
                if len(value) > _MAX_HEADER_VALUE_LEN:
                    raise ValueError(
                        f"Header {key!r} value exceeds {_MAX_HEADER_VALUE_LEN} chars"
                    )
        return v

    @field_validator("discovery_policy")
    @classmethod
    def validate_discovery_policy(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_dict_size(v, "discovery_policy")

    @field_validator("health_policy")
    @classmethod
    def validate_health_policy(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_dict_size(v, "health_policy")


class ProviderEndpointUpdateRequest(BaseModel):
    """Request body for ``update_provider_endpoint``. All fields optional except ``id``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str
    name: str | None = None
    adapter_type: str | None = Field(None, alias="adapterType")
    base_url: str | None = Field(None, alias="baseUrl")
    enabled: bool | None = None
    default_headers: dict[str, Any] | None = Field(None, alias="defaultHeaders")
    discovery_policy: dict[str, Any] | None = Field(None, alias="discoveryPolicy")
    health_policy: dict[str, Any] | None = Field(None, alias="healthPolicy")

    @field_validator("adapter_type")
    @classmethod
    def validate_adapter_type(cls, v: str | None) -> str | None:
        if v is not None:
            return ProviderEndpointCreateRequest.validate_adapter_type(v)
        return v

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, v: str | None) -> str | None:
        if v is not None:
            return ProviderEndpointCreateRequest.validate_base_url(v)
        return v

    @field_validator("default_headers")
    @classmethod
    def validate_default_headers(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is not None:
            return ProviderEndpointCreateRequest.validate_default_headers(v)
        return v

    @field_validator("discovery_policy")
    @classmethod
    def validate_discovery_policy(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is not None:
            return ProviderEndpointCreateRequest.validate_discovery_policy(v)
        return v

    @field_validator("health_policy")
    @classmethod
    def validate_health_policy(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is not None:
            return ProviderEndpointCreateRequest.validate_health_policy(v)
        return v


class ProviderEndpointIdRequest(BaseModel):
    """Request body for ``get_provider_endpoint`` / ``delete_provider_endpoint``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str


class ProviderEndpointResponse(BaseModel):
    """Wire DTO for :class:`ProviderEndpoint`."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    adapter_type: str = Field(alias="adapterType")
    base_url: str = Field(alias="baseUrl")
    enabled: bool
    default_headers: dict[str, Any] | None = Field(None, alias="defaultHeaders")
    discovery_policy: dict[str, Any] | None = Field(None, alias="discoveryPolicy")
    health_policy: dict[str, Any] | None = Field(None, alias="healthPolicy")
    circuit_state: str = Field(alias="circuitState")
    circuit_opened_at: datetime | None = Field(None, alias="circuitOpenedAt")
    circuit_retry_at: datetime | None = Field(None, alias="circuitRetryAt")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")

    @classmethod
    def from_orm_model(cls, obj: ProviderEndpoint) -> ProviderEndpointResponse:
        return cls(
            id=obj.id,
            name=obj.name,
            adapter_type=obj.adapter_type,
            base_url=obj.base_url,
            enabled=obj.enabled,
            default_headers=obj.default_headers,
            discovery_policy=obj.discovery_policy,
            health_policy=obj.health_policy,
            circuit_state=obj.circuit_state,
            circuit_opened_at=obj.circuit_opened_at,
            circuit_retry_at=obj.circuit_retry_at,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )
