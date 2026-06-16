"""Pydantic schemas for Accounts domain — request/response DTOs.

Field names use **camelCase** aliases to match the Rust-generated TypeScript
types so the frontend can consume responses without transformation.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


# ── Response ──────────────────────────────────────────────────────────────────

class AccountResponse(BaseModel):
    """Wire-compatible with the Rust ``Account`` type in generated.ts."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    email: str
    provider: str
    status: str = "active"
    display_name: str | None = Field(None, alias="displayName")

    # Tokens
    token: str | None = None
    refresh_token: str | None = Field(None, alias="refreshToken")
    expires_at: str | None = Field(None, alias="expiresAt")
    token_type: str | None = Field(None, alias="tokenType")
    api_key: str | None = Field(None, alias="apiKey")

    # Machine
    machine_id: str | None = Field(None, alias="machineId")
    patch_config: Any | None = Field(None, alias="patchConfig")

    # Browser
    browser_profile_path: str | None = Field(None, alias="browserProfilePath")
    cookies: str | None = None
    session_data: str | None = Field(None, alias="sessionData")

    # Proxy
    proxy_id: str | None = Field(None, alias="proxyId")

    # Meta
    notes: str | None = None
    tags: str | None = None  # JSON string for frontend compat
    use_count: int = Field(0, alias="useCount")
    success_rate: float = Field(1.0, alias="successRate")
    last_used_at: str | None = Field(None, alias="lastUsedAt")
    last_checked_at: str | None = Field(None, alias="lastCheckedAt")
    registration_source: str | None = Field(None, alias="registrationSource")

    # Timestamps
    created_at: str = Field(alias="createdAt")
    updated_at: str | None = Field(None, alias="updatedAt")

    # OmniRoute
    is_llm_account: bool = Field(False, alias="isLlmAccount")
    omniroute_connection_id: str | None = Field(None, alias="omnirouteConnectionId")

    # Legacy compat fields (nullable, present in generated.ts)
    metadata: str | None = None
    provider_type: str | None = Field(None, alias="providerType")
    provider_sub_type: str | None = Field(None, alias="providerSubtype")
    provider_metadata: str | None = Field(None, alias="providerMetadata")
    last_error: str | None = Field(None, alias="lastError")
    error_count: int = Field(0, alias="errorCount")
    login_count: int = Field(0, alias="loginCount")
    account_region: str | None = Field(None, alias="accountRegion")

    @model_validator(mode="before")
    @classmethod
    def _from_orm(cls, data: Any) -> Any:
        """Convert an Account ORM object into a validated dict.

        Handles datetime→ISO-string, JSON→string, and ORM field-name
        mismatches (e.g. ``profile_path`` → ``browser_profile_path``).
        Plain dicts (already serialised) pass through unchanged.
        """
        if not hasattr(data, "__dict__") or isinstance(data, dict):
            return data

        def _dt(v: Any) -> str | None:
            if isinstance(v, datetime):
                return v.isoformat()
            return v.isoformat() if v else None

        def _json(v: Any) -> str | None:
            if v is None:
                return None
            return json.dumps(v) if not isinstance(v, str) else v

        # ORM attr → response field name (only mismatches need renaming)
        _rename = {"profile_path": "browser_profile_path"}

        processed: dict[str, Any] = {}
        for attr in vars(data):
            if attr.startswith("_"):
                continue
            key = _rename.get(attr, attr)
            val = getattr(data, attr)
            if isinstance(val, datetime):
                processed[key] = _dt(val)
            elif attr in ("patch_config", "fingerprint", "proxy_config"):
                processed[key] = _json(val)
            elif attr == "tags":
                processed[key] = _json(val)
            else:
                processed[key] = val

        return processed


# ── Request DTOs ──────────────────────────────────────────────────────────────

class ListAccountsRequest(BaseModel):
    provider: str | None = None
    provider_type: str | None = Field(None, alias="providerType")
    provider_subtype: str | None = Field(None, alias="providerSubtype")
    show_archived: bool = Field(False, alias="showArchived")


class AddAccountRequest(BaseModel):
    provider: str
    email: str
    password: str | None = None
    token: str | None = None
    refresh_token: str | None = Field(None, alias="refreshToken")
    api_key: str | None = Field(None, alias="apiKey")
    display_name: str | None = Field(None, alias="displayName")
    metadata: str | None = None
    is_llm_account: bool = Field(False, alias="isLlmAccount")


class DeleteAccountRequest(BaseModel):
    id: str | int


class UpdateAccountTokenRequest(BaseModel):
    id: str | int
    token: str
    refresh_token: str | None = Field(None, alias="refreshToken")
    metadata: str | None = None


class UpdateAccountNotesTagsRequest(BaseModel):
    id: str | int
    notes: str | None = None
    tags: str | None = None


class UpdateAccountMetadataRequest(BaseModel):
    account_id: int | str = Field(alias="accountId")
    metadata: str | None = None


class SetAccountProxyRequest(BaseModel):
    account_id: int | str = Field(alias="accountId")
    proxy_id: str | None = Field(None, alias="proxyId")


class RefreshAccountRequest(BaseModel):
    account_id: int | str = Field(alias="accountId")


class GetAccountQuotaRequest(BaseModel):
    account_id: int | str = Field(alias="accountId")


class ArchiveAccountRequest(BaseModel):
    id: str | int
    archived: bool = True


class BulkDeleteRequest(BaseModel):
    ids: list[str | int]


class BulkExportRequest(BaseModel):
    provider: str | None = None
    ids: list[str | int] | None = None
