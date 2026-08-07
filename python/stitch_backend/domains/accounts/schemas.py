"""Pydantic schemas for Accounts domain — request/response DTOs.

Field names use **camelCase** aliases to match the Rust-generated TypeScript
types so the frontend can consume responses without transformation.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


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

    # Quota (nested object matching frontend SimpleQuotaInfo)
    quota: dict[str, Any] | None = Field(None, alias="quota")

    # Registration data (frontend Account type)
    registration_password: str | None = Field(None, alias="registrationPassword")
    registration_date: str | None = Field(None, alias="registrationDate")
    registration_method: str | None = Field(None, alias="registrationMethod")
    registration_metadata: str | None = Field(None, alias="registrationMetadata")

    # Patch
    patch_applied_at: str | None = Field(None, alias="patchAppliedAt")

    # Login stats
    last_login_at: str | None = Field(None, alias="lastLoginAt")

    # Referral (v0 quota system)
    ref_code: str | None = Field(None, alias="refCode")
    ref_url: str | None = Field(None, alias="refUrl")
    ref_used_count: int = Field(0, alias="refUsedCount")
    ref_max_count: int = Field(40, alias="refMaxCount")
    referred_by_id: str | None = Field(None, alias="referredById")

    # Timestamps
    created_at: str = Field(alias="createdAt")
    updated_at: str | None = Field(None, alias="updatedAt")

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
            elif attr in ("patch_config", "fingerprint", "proxy_config", "provider_metadata"):
                processed[key] = _json(val)
            elif attr == "tags":
                processed[key] = _json(val)
            else:
                processed[key] = val

        # Legacy DBs store ``id`` as INTEGER — coerce to str for the API.
        if processed.get("id") is not None:
            processed["id"] = str(processed["id"])

        # Map password → registrationPassword (frontend expects this field)
        if "password" in processed:
            processed["registration_password"] = processed["password"]

        # Map registration_source → registrationMethod (semantically equivalent)
        if "registration_source" in processed:
            processed["registration_method"] = processed["registration_source"]

        # Build nested quota object from persisted columns
        quota_used = processed.get("quota_used", 0) or 0
        quota_limit = processed.get("quota_limit", 0) or 0
        quota_checked_at = processed.get("quota_checked_at")
        processed["quota"] = {
            "used": quota_used,
            "limit": quota_limit,
            "resetAt": _dt(quota_checked_at) if isinstance(quota_checked_at, datetime) else (
                quota_checked_at if isinstance(quota_checked_at, str) else None
            ),
        }

        return processed

    @field_validator("provider_metadata", mode="before")
    @classmethod
    def _coerce_provider_metadata(cls, v: Any) -> Any:
        """Serialize dict/list to JSON string regardless of the input path.

        _from_orm only fires for ORM objects. When data arrives as a plain
        dict (raw SQL, SimpleNamespace already processed, import payloads),
        _from_orm returns early and Pydantic receives the raw dict value.
        This validator catches that case on the field level.
        """
        if v is None or isinstance(v, str):
            return v
        return json.dumps(v)


# ── Request DTOs ──────────────────────────────────────────────────────────────

class ListAccountsRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider: str | None = None
    provider_type: str | None = Field(None, alias="providerType")
    provider_subtype: str | None = Field(None, alias="providerSubtype")
    show_archived: bool = Field(False, alias="showArchived")


class AddAccountRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider: str
    email: str
    password: str | None = None
    token: str | None = None
    refresh_token: str | None = Field(None, alias="refreshToken")
    api_key: str | None = Field(None, alias="apiKey")
    display_name: str | None = Field(None, alias="displayName")
    metadata: str | None = None


class DeleteAccountRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str | int


class UpdateAccountTokenRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str | int
    token: str
    refresh_token: str | None = Field(None, alias="refreshToken")
    metadata: str | None = None


class UpdateAccountNotesTagsRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str | int
    notes: str | None = None
    tags: str | None = None


class UpdateAccountMetadataRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    account_id: int | str = Field(alias="accountId")


class SetAccountProxyRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    account_id: int | str = Field(alias="accountId")
    proxy_id: str | None = Field(None, alias="proxyId")


class RefreshAccountRequest(BaseModel):
    """Request body for ``refresh_account`` command.

    Accepts ``accountId`` (primary, used by the frontend) and ``id``
    (defense-in-depth for MCP tools and other clients that send ``id``).
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    account_id: int | str = Field(
        alias="accountId",
        validation_alias=AliasChoices("accountId", "id"),
    )


class GetAccountQuotaRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    account_id: int | str = Field(alias="accountId")


class RefreshAccountsRequest(BaseModel):
    """Request body for the batch ``refresh_accounts`` command.

    ``accountIds`` must be non-empty and capped at 200 to prevent
    unbounded fan-out.  Exceeding the cap raises ``ValidationError``.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    account_ids: list[int | str] = Field(
        alias="accountIds",
        min_length=1,
        max_length=200,
    )


class ArchiveAccountRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str | int
    archived: bool = True


class BulkDeleteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    ids: list[str | int]


class BulkExportRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider: str | None = None
    ids: list[str | int] | None = None


# ── Kiro-specific request DTOs ────────────────────────────────────────────────

class RefreshKiroTokenRequest(BaseModel):
    """Request body for ``refresh_kiro_token`` command."""
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    account_id: str | int = Field(alias="accountId")
    proxy: str | None = None
    force: bool = False  # refresh even if token is still valid


class CheckKiroAccountRequest(BaseModel):
    """Request body for ``check_kiro_account`` command."""
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    account_id: str | int = Field(alias="accountId")
    proxy: str | None = None
    auto_refresh: bool = Field(True, alias="autoRefresh")



