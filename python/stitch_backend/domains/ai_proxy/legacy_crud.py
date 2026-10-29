"""Legacy account CRUD over the ai_gateway credential tables."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import or_, select

from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialSecret,
    ProviderEndpoint,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialService,
    compute_fingerprint,
)
from stitch_backend.domains.ai_proxy.legacy_convert import (
    _credential_to_account,
    _get_or_create_endpoint,
)
from stitch_backend.domains.ai_proxy.legacy_mapping import (
    _decode_old_label,
    _display_name,
    _encode_metadata,
    _find_credential_by_legacy_id,
    _legacy_id,
    _pick_secret,
    _ts_to_dt,
)


async def list_accounts(
    session: Any,
    owner_id: int | None = None,
    *,
    caller_uid: int | None = None,
    caller_role: str | None = None,
) -> list[dict[str, Any]]:
    """Return all credentials visible to *owner_id* as legacy account dicts.

    When ``caller_uid`` / ``caller_role`` are provided, secrets are
    masked for non-owner, non-admin callers (see
    :func:`_should_mask_secret`).
    """
    stmt = select(Credential).where(
        or_(
            Credential.owner_id.is_(None),
            Credential.owner_id == owner_id,
        )
    ).order_by(Credential.created_at.desc())
    result = await session.execute(stmt)
    credentials = list(result.scalars().all())

    accounts: list[dict[str, Any]] = []
    for cred in credentials:
        acct = await _credential_to_account(
            session, cred,
            caller_uid=caller_uid,
            caller_role=caller_role,
        )
        accounts.append(acct)
    return accounts


async def create_account(
    session: Any, account: dict[str, Any], owner_id: int | None = None
) -> int:
    """Create a Credential + Secret + (maybe) Endpoint from a legacy account dict."""
    provider = str(account.get("provider", "")).strip()
    if not provider:
        provider = "unknown"

    secret, auth_type = _pick_secret(account)
    if not secret:
        # legacy accounts may exist without a secret — keep an empty placeholder.
        secret = ""
        auth_type = "api_key"

    endpoint = await _get_or_create_endpoint(
        session,
        provider=provider,
        base_url=account.get("baseUrl") or account.get("base_url"),
        owner_id=owner_id,
    )

    # name → label (plain string); extras → legacy_metadata (JSON dict).
    label = account.get("name", "") or ""
    metadata = _encode_metadata(account)

    svc = CredentialService(session)
    credential = await svc.create_credential(
        provider_endpoint_id=endpoint.id,
        label=label,
        auth_type=auth_type,
        secret=secret,
        owner_id=owner_id,
    )

    # persist extras + legacy `enabled` flag (create_credential defaults to True).
    touched = False
    if metadata:
        credential.legacy_metadata = metadata
        touched = True
    if not bool(account.get("enabled", True)):
        credential.enabled = False
        touched = True
    if touched:
        await session.flush()

    # Update the CredentialSecret with OAuth metadata if present.
    if account.get("oauthRefreshToken") or account.get("oauthExpiresAt"):
        result = await session.execute(
            select(CredentialSecret).where(
                CredentialSecret.credential_id == credential.id
            )
        )
        secret_row = result.scalar_one_or_none()
        if secret_row is not None:
            secret_row.refresh_token = account.get("oauthRefreshToken") or account.get("oauth_refresh_token")
            secret_row.expires_at = _ts_to_dt(
                account.get("oauthExpiresAt") or account.get("oauth_expires_at")
            )
            secret_row.updated_at = datetime.now(UTC)
            await session.flush()

    return _legacy_id(credential.id)


async def update_account(
    session: Any, account: dict[str, Any], owner_id: int | None = None
) -> None:
    """Update a Credential from a legacy account dict."""
    legacy_id = account.get("id")
    if legacy_id is None:
        return

    credential = await _find_credential_by_legacy_id(session, int(legacy_id))
    if credential is None:
        return

    # Update label (name) and legacy_metadata (extras).
    credential.label = account.get("name", "") or ""
    credential.legacy_metadata = _encode_metadata(account)
    credential.enabled = bool(account.get("enabled", True))
    credential.updated_at = datetime.now(UTC)

    # Update secret if a new one is provided.
    secret, auth_type = _pick_secret(account)
    if secret:
        # Resolve endpoint for fingerprint.
        result = await session.execute(
            select(ProviderEndpoint).where(
                ProviderEndpoint.id == credential.provider_endpoint_id
            )
        )
        endpoint = result.scalar_one_or_none()
        if endpoint is not None:
            new_fp = compute_fingerprint(endpoint.id, secret)
            if new_fp != credential.fingerprint:
                # Rotate the secret via the service.
                svc = CredentialService(session)
                await svc.rotate_secret(credential.id, secret)
                # rotate_secret refreshes the credential; re-fetch.
                result = await session.execute(
                    select(Credential).where(Credential.id == credential.id)
                )
                credential = result.scalar_one()

    # Update OAuth metadata on the secret row.
    if account.get("oauthRefreshToken") or account.get("oauthExpiresAt"):
        result = await session.execute(
            select(CredentialSecret).where(
                CredentialSecret.credential_id == credential.id
            )
        )
        secret_row = result.scalar_one_or_none()
        if secret_row is not None:
            secret_row.refresh_token = account.get("oauthRefreshToken") or account.get("oauth_refresh_token")
            secret_row.expires_at = _ts_to_dt(
                account.get("oauthExpiresAt") or account.get("oauth_expires_at")
            )
            secret_row.updated_at = datetime.now(UTC)

    await session.flush()


async def delete_account(session: Any, account_id: int) -> None:
    """Delete a Credential by its legacy int ID."""
    credential = await _find_credential_by_legacy_id(session, int(account_id))
    if credential is None:
        return
    await session.delete(credential)
    await session.flush()


async def get_account_by_name(
    session: Any, provider: str, name: str
) -> dict[str, Any] | None:
    """Find a credential whose endpoint matches *provider* and label name == *name*."""
    ep_name = _display_name(provider)
    result = await session.execute(
        select(Credential, ProviderEndpoint)
        .join(ProviderEndpoint, Credential.provider_endpoint_id == ProviderEndpoint.id)
        .where(ProviderEndpoint.name == ep_name)
    )
    for cred, ep in result.all():
        # Check label (new format: plain string) or old JSON-in-label.
        label_name = cred.label or ""
        if not _decode_old_label(cred.label) and cred.label:
            # New format: label is the name directly.
            pass
        else:
            # Old format: label is JSON dict with 'name' key.
            old_data = _decode_old_label(cred.label)
            label_name = old_data.get("name", "")
        if label_name.lower() == name.lower():
            return await _credential_to_account(session, cred, endpoint=ep)
    return None
