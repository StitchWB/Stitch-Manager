"""UserProxyKey request/response schemas."""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 — pydantic resolves annotations at runtime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ProxyKeyCreateRequest(BaseModel):
    """Request body for ``proxy_keys_create``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    label: str | None = Field(None, max_length=200)


class ProxyKeyRevokeRequest(BaseModel):
    """Request body for ``proxy_keys_revoke``."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str


class ProxyKeyResponse(BaseModel):
    """Wire DTO for a single proxy key (masked — raw never returned)."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    label: str | None = None
    masked_key: str = Field(alias="maskedKey")
    enabled: bool
    created_at: datetime = Field(alias="createdAt")
    last_used_at: datetime | None = Field(None, alias="lastUsedAt")
    is_default: bool = Field(alias="isDefault")


class ProxyKeyCreatedResponse(BaseModel):
    """Response for ``proxy_keys_create`` — raw key shown ONCE.

    P2.16: ``key`` is a plain ``str`` (NOT ``SecretStr``) because the
    wire payload must contain the raw key exactly once for the client
    to display/copy.  ``SecretStr`` would serialize as ``**********``
    and break the wire contract.  Instead, ``__repr__`` is overridden
    to mask the key so it never leaks in logs or debugger traces.
    """

    model_config = ConfigDict(populate_by_name=True)

    key: str  # RAW — shown once, never persisted
    id: str

    def __repr__(self) -> str:
        """Mask the raw key in repr to prevent log/debugger leakage."""
        masked = _mask_for_repr(self.key) if self.key else "None"
        return f"ProxyKeyCreatedResponse(key={masked!r}, id={self.id!r})"


def _mask_for_repr(raw: str) -> str:
    """Mask a raw key for repr: first4+****+last4."""
    if len(raw) < 8:
        return "****"
    return raw[:4] + "****" + raw[-4:]


class ProxyKeyPoolGroupEntry(BaseModel):
    """One group entry in the ``pool`` summary of ``proxy_keys_list``."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    keys: int


class ProxyKeyListResponse(BaseModel):
    """Response for ``proxy_keys_list`` — keys + pool summary + base_url."""

    model_config = ConfigDict(populate_by_name=True)

    base_url: str = Field(alias="baseUrl")
    keys: list[ProxyKeyResponse]
    pool: dict[str, Any]
