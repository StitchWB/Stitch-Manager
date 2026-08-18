"""Pydantic request/response schemas for the ai_gateway domain.

Per the project's type-validation convention, incoming params are validated
through Pydantic models with ``populate_by_name=True`` and camelCase
aliases via ``Field(alias=...)`` so both camelCase (frontend-native) and
snake_case keys are accepted on the way in. The dispatcher
(``cmd_dispatcher._serialise``) handles ``model_dump(mode="json",
by_alias=True)`` automatically on the way out, so response schemas below
use plain Python types (``datetime``, ``dict``) rather than pre-serialising
to strings — that JSON-to-str convention is specific to
``AccountResponse``'s wire contract, not a general project rule.

IMPORTANT: ``CredentialResponse`` intentionally never references
``CredentialSecret`` — the whole point of splitting that table out is that
credential listing/health code paths structurally cannot carry secret
material. Never add a ``secret``/``secretValue`` field to this schema.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

if TYPE_CHECKING:
    from stitch_backend.domains.ai_gateway.models import (
        Credential,
        CredentialModelAccess,
        ProviderEndpoint,
        PublicModel,
        RouteTarget,
        UpstreamModel,
    )

# ── Input validation allow-lists (ponytail: set-based; extend when new types land) ─
_VALID_ADAPTER_TYPES = {"openai_compatible", "anthropic", "gemini"}
_VALID_AUTH_TYPES = {"api_key", "oauth", "session"}

# Headers a caller must not set via default_headers — they're either
# transport-controlled (host, content-length) or security-sensitive
# (authorization, x-forwarded-for). Setting them would let a caller
# spoof identity or break routing.
_BLOCKED_HEADERS = frozenset({
    "host", "x-forwarded-for", "x-real-ip", "content-length",
    "transfer-encoding", "connection", "authorization",
})

# Max serialized JSON size for free-form dict fields (discovery_policy,
# health_policy, capabilities). 10KB is plenty for policy blobs while
# bounding storage abuse. ponytail: lower if a real policy shape lands.
_MAX_DICT_JSON_BYTES = 10240

# Max length of a single default_header value — guards against header
# injection (newlines) and unbounded storage.
_MAX_HEADER_VALUE_LEN = 2000


def _validate_dict_size(v: dict[str, Any] | None, field: str) -> dict[str, Any] | None:
    """Reject free-form dicts whose serialized JSON exceeds the size cap."""
    if v is None:
        return v
    if len(json.dumps(v)) > _MAX_DICT_JSON_BYTES:
        raise ValueError(
            f"{field} serialized JSON exceeds {_MAX_DICT_JSON_BYTES} bytes"
        )
    return v

# ═══════════════════════════════════════════════════════════════════════════
# ProviderEndpoint
# ═══════════════════════════════════════════════════════════════════════════


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

        # DNS-resolution SSRF guard: resolve hostname and block private/reserved IPs for HTTPS.
        # This prevents SSRF via DNS rebinding (e.g., domain that resolves to 169.254.169.254).
        # ponytail: upgrade path — add explicit allowlist for dev/test environments.
        if parsed.scheme.lower() == "https":
            try:
                import ipaddress
                import socket

                # Resolve hostname to IP addresses
                addrinfos = socket.getaddrinfo(parsed.hostname, None)
                for addrinfo in addrinfos:
                    ip_str = addrinfo[4][0]
                    ip = ipaddress.ip_address(ip_str)

                    # Block private/reserved IPs for HTTPS
                    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                        raise ValueError(
                            f"base_url resolves to private/reserved IP {ip} — "
                            "HTTPS to internal networks is blocked to prevent SSRF"
                        )
            except (socket.gaierror, ValueError) as e:
                # DNS resolution failed or IP parsing failed — block it
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
            # Header-injection guard: reject CR/LF in values, and bound
            # the value length so a caller can't smuggle extra headers or
            # store unbounded blobs.
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


# ═══════════════════════════════════════════════════════════════════════════
# Credential
# ═══════════════════════════════════════════════════════════════════════════


class CredentialCreateRequest(BaseModel):
    """Request body for ``create_credential``.

    ``secret`` is the RAW secret value — the service layer hashes it into
    ``fingerprint`` (dedup key) and stores the raw value in
    ``CredentialSecret``. It is never persisted as-is on ``Credential``.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider_endpoint_id: str = Field(alias="providerEndpointId")
    label: str | None = Field(None, max_length=200)
    auth_type: str = Field("api_key", alias="authType")
    secret: str = Field(max_length=4096)

    @field_validator("auth_type")
    @classmethod
    def validate_auth_type(cls, v: str) -> str:
        if v not in _VALID_AUTH_TYPES:
            raise ValueError(
                f"Invalid auth_type: {v!r}. "
                f"Valid values: {sorted(_VALID_AUTH_TYPES)}"
            )
        return v

    @field_validator("secret")
    @classmethod
    def validate_secret(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("secret must not be empty")
        return v


class CredentialUpdateRequest(BaseModel):
    """Request body for ``update_credential``.

    Deliberately does NOT accept a secret field — secret rotation is a
    separate explicit action (see ``rotate_credential_secret``).
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str
    label: str | None = None
    enabled: bool | None = None


class RotateCredentialSecretRequest(BaseModel):
    """Request body for ``rotate_credential_secret``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str
    new_secret: str = Field(alias="newSecret", max_length=4096)

    @field_validator("new_secret")
    @classmethod
    def validate_new_secret(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("new_secret must not be empty")
        return v


class CredentialIdRequest(BaseModel):
    """Request body for ``get_credential`` / ``delete_credential``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str


class ListCredentialsRequest(BaseModel):
    """Request body for ``list_credentials``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider_endpoint_id: str | None = Field(None, alias="providerEndpointId")


class CredentialResponse(BaseModel):
    """Wire DTO for :class:`Credential`.

    Never references ``CredentialSecret`` — no secret/raw-key field exists
    on this schema, by design.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    provider_endpoint_id: str = Field(alias="providerEndpointId")
    label: str | None = None
    auth_type: str = Field(alias="authType")
    fingerprint: str
    enabled: bool
    runtime_status: str = Field(alias="runtimeStatus")
    status_reason: str | None = Field(None, alias="statusReason")
    next_retry_at: datetime | None = Field(None, alias="nextRetryAt")
    quota_reset_at: datetime | None = Field(None, alias="quotaResetAt")
    last_success_at: datetime | None = Field(None, alias="lastSuccessAt")
    last_failure_at: datetime | None = Field(None, alias="lastFailureAt")
    consecutive_failures: int = Field(alias="consecutiveFailures")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")

    @classmethod
    def from_orm_model(cls, obj: Credential) -> CredentialResponse:
        return cls(
            id=obj.id,
            provider_endpoint_id=obj.provider_endpoint_id,
            label=obj.label,
            auth_type=obj.auth_type,
            fingerprint=obj.fingerprint,
            enabled=obj.enabled,
            runtime_status=obj.runtime_status,
            status_reason=obj.status_reason,
            next_retry_at=obj.next_retry_at,
            quota_reset_at=obj.quota_reset_at,
            last_success_at=obj.last_success_at,
            last_failure_at=obj.last_failure_at,
            consecutive_failures=obj.consecutive_failures,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )


# ═══════════════════════════════════════════════════════════════════════════
# UpstreamModel
# ═══════════════════════════════════════════════════════════════════════════


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
    """Request body for ``list_upstream_models``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider_endpoint_id: str | None = Field(None, alias="providerEndpointId")


class UpstreamModelResponse(BaseModel):
    """Wire DTO for :class:`UpstreamModel`."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    provider_endpoint_id: str = Field(alias="providerEndpointId")
    upstream_model_id: str = Field(alias="upstreamModelId")
    display_name: str | None = Field(None, alias="displayName")
    enabled: bool
    discovery_source: str = Field(alias="discoverySource")
    last_discovered_at: datetime | None = Field(None, alias="lastDiscoveredAt")
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
            last_discovered_at=obj.last_discovered_at,
            capabilities=obj.capabilities,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )


# ═══════════════════════════════════════════════════════════════════════════
# CredentialModelAccess
# ═══════════════════════════════════════════════════════════════════════════


class CredentialModelAccessUpsertRequest(BaseModel):
    """Request body for ``upsert_credential_model_access``.

    Idempotent by the ``(credentialId, upstreamModelId)`` unique constraint.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    credential_id: str = Field(alias="credentialId")
    upstream_model_id: str = Field(alias="upstreamModelId")
    status: str = "unknown"
    last_error: str | None = Field(None, alias="lastError")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        allowed = {"unknown", "available", "unavailable"}
        if v not in allowed:
            raise ValueError(f"status must be one of {allowed}")
        return v

    @field_validator("last_error")
    @classmethod
    def validate_last_error(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 2000:
            raise ValueError("last_error must be <= 2000 characters")
        return v


class ListCredentialModelAccessRequest(BaseModel):
    """Request body for ``list_credential_model_access``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    credential_id: str | None = Field(None, alias="credentialId")
    upstream_model_id: str | None = Field(None, alias="upstreamModelId")


class CredentialModelAccessIdRequest(BaseModel):
    """Request body for ``delete_credential_model_access``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: int


class CredentialModelAccessResponse(BaseModel):
    """Wire DTO for :class:`CredentialModelAccess`."""

    model_config = ConfigDict(populate_by_name=True)

    id: int
    credential_id: str = Field(alias="credentialId")
    upstream_model_id: str = Field(alias="upstreamModelId")
    status: str
    last_verified_at: datetime | None = Field(None, alias="lastVerifiedAt")
    last_error: str | None = Field(None, alias="lastError")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime | None = Field(None, alias="updatedAt")

    @classmethod
    def from_orm_model(cls, obj: CredentialModelAccess) -> CredentialModelAccessResponse:
        return cls(
            id=obj.id,
            credential_id=obj.credential_id,
            upstream_model_id=obj.upstream_model_id,
            status=obj.status,
            last_verified_at=obj.last_verified_at,
            last_error=obj.last_error,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )


# ═══════════════════════════════════════════════════════════════════════════
# PublicModel
# ═══════════════════════════════════════════════════════════════════════════


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


# ═══════════════════════════════════════════════════════════════════════════
# RouteTarget
# ═══════════════════════════════════════════════════════════════════════════


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
