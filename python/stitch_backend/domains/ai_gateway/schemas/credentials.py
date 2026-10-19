"""Credential request/response schemas (secret material never round-trips)."""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 — pydantic resolves annotations at runtime
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, field_validator

if TYPE_CHECKING:
    from stitch_backend.domains.ai_gateway.models import Credential

_VALID_AUTH_TYPES = {"api_key", "oauth", "session"}


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

    Wave-2 additions: ``owner_id`` + ``shared_group_ids`` /
    ``shared_group_names`` so the FE can render scope chips.  Existing
    fields are unchanged.
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
    # Scope fields — FE renders scope chips from these.
    owner_id: int | None = Field(None, alias="ownerId")
    shared_group_ids: list[str] = Field(
        default_factory=list, alias="sharedGroupIds",
    )
    shared_group_names: list[str] = Field(
        default_factory=list, alias="sharedGroupNames",
    )

    @classmethod
    def from_orm_model(
        cls,
        obj: Credential,
        *,
        shared_group_ids: list[str] | None = None,
        shared_group_names: list[str] | None = None,
    ) -> CredentialResponse:
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
            owner_id=obj.owner_id,
            shared_group_ids=shared_group_ids or [],
            shared_group_names=shared_group_names or [],
        )
