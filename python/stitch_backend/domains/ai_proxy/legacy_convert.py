"""Credential ↔ legacy account dict conversion and provider endpoint resolution."""

from __future__ import annotations

import time
from typing import Any, cast

from sqlalchemy import select

from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialSecret,
    ProviderEndpoint,
)
from stitch_backend.domains.ai_gateway.service import ProviderEndpointService
from stitch_backend.domains.ai_proxy.legacy_authz import _should_mask_secret
from stitch_backend.domains.ai_proxy.legacy_mapping import (
    _adapter_type_for_provider,
    _decode_metadata,
    _decode_old_label,
    _default_base_url,
    _display_name,
    _dt_to_ts,
    _legacy_id,
    _mask_secret,
)


async def _get_or_create_endpoint(
    session: Any,
    *,
    provider: str,
    base_url: str | None = None,
    owner_id: int | None = None,
) -> ProviderEndpoint:
    """Find or create a ProviderEndpoint for *provider* + *base_url*."""
    url = base_url or _default_base_url(provider)
    name = _display_name(provider)

    result = await session.execute(
        select(ProviderEndpoint).where(
            ProviderEndpoint.name == name,
            ProviderEndpoint.base_url == url,
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return cast("ProviderEndpoint", existing)

    svc = ProviderEndpointService(session)
    endpoint = await svc.create_endpoint(
        name=name,
        adapter_type=_adapter_type_for_provider(provider),
        base_url=url,
        enabled=True,
        owner_id=owner_id,
    )
    return endpoint


async def _credential_to_account(
    session: Any,
    credential: Credential,
    endpoint: ProviderEndpoint | None = None,
    secret_row: CredentialSecret | None = None,
    *,
    caller_uid: int | None = None,
    caller_role: str | None = None,
) -> dict[str, Any]:
    """Map a Credential row back to the legacy AiProxyAccount dict shape.

    When ``caller_uid`` / ``caller_role`` are provided, secrets are
    masked for non-owner, non-admin callers (instance-shared rows are
    masked for non-admin; own rows are raw).  When both are ``None``
    (desktop / auth-disabled), secrets are raw (legacy behaviour).
    """
    if endpoint is None:
        result = await session.execute(
            select(ProviderEndpoint).where(
                ProviderEndpoint.id == credential.provider_endpoint_id
            )
        )
        endpoint = result.scalar_one_or_none()
    if secret_row is None:
        result = await session.execute(
            select(CredentialSecret).where(
                CredentialSecret.credential_id == credential.id
            )
        )
        secret_row = result.scalar_one_or_none()

    provider = ""
    if endpoint is not None:
        # Reverse-derive provider from endpoint name (best-effort).
        provider = endpoint.name.lower().replace(" ", "_")

    # name = label (plain string); un-migrated rows fall back to old JSON-in-label.
    name = credential.label or ""
    metadata = _decode_metadata(credential.legacy_metadata)
    if not metadata and credential.label:
        # Un-migrated row: label may be old JSON dict format.
        old_data = _decode_old_label(credential.label)
        if old_data and "name" in old_data:
            name = old_data.get("name", "")
            metadata = {k: v for k, v in old_data.items() if k != "name"}

    # Reconstruct the secret fields based on auth_type.
    api_key: str | None = None
    oauth_token: str | None = None
    session_token: str | None = None
    if secret_row is not None:
        if credential.auth_type == "api_key":
            api_key = secret_row.secret_value
        elif credential.auth_type == "oauth":
            oauth_token = secret_row.secret_value
        elif credential.auth_type == "session":
            session_token = secret_row.secret_value

    # FE contract: non-admin callers see masked secrets on shared rows.
    if caller_uid is not None or caller_role is not None:
        if _should_mask_secret(credential, caller_uid, caller_role):
            api_key = _mask_secret(api_key)
            oauth_token = _mask_secret(oauth_token)
            session_token = _mask_secret(session_token)

    now_ts = int(time.time())

    return {
        "id": _legacy_id(credential.id),
        "provider": provider,
        "name": name,
        "oauthToken": oauth_token,
        "apiKey": api_key,
        "sessionToken": session_token,
        "enabled": bool(credential.enabled),
        "accountType": metadata.get("accountType"),
        "requestsToday": 0,
        "requestsTotal": 0,
        "tokensUsed": 0,
        "lastUsedAt": _dt_to_ts(credential.last_success_at),
        "softQuotaTokensDaily": metadata.get("softQuotaTokensDaily"),
        "softQuotaRequestsDaily": metadata.get("softQuotaRequestsDaily"),
        "createdAt": _dt_to_ts(credential.created_at) or now_ts,
        "updatedAt": _dt_to_ts(credential.updated_at) or now_ts,
        "oauthRefreshToken": secret_row.refresh_token if secret_row else None,
        "oauthExpiresAt": _dt_to_ts(secret_row.expires_at) if secret_row else None,
        "oauthScopes": metadata.get("oauthScopes"),
        "oauthTokenType": metadata.get("oauthTokenType"),
        "refCode": metadata.get("refCode"),
        "refUrl": metadata.get("refUrl"),
        # None-safe reads: `or` would coerce a stored 0 back to the default.
        "refUsedCount": metadata["refUsedCount"] if metadata.get("refUsedCount") is not None else 0,
        "refMaxCount": metadata["refMaxCount"] if metadata.get("refMaxCount") is not None else 40,
        "referredById": metadata.get("referredById"),
    }
