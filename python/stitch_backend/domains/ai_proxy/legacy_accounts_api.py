"""Legacy ai_proxy_accounts ↔ ai_gateway tables alias bridge (L2 final wave).

This module provides the field-mapping logic that lets the old
``ai_proxy_accounts`` CRUD commands read/write the new
``ai_gateway_credentials`` / ``CredentialSecret`` / ``ProviderEndpoint``
tables instead, so the frontend (``aiProxy.ts``) and mcp_server keep
working unchanged.

L2 final wave: the legacy ``ai_proxy_accounts`` table is now INERT.
Runtime CRUD (list/create/update/delete/export/import/auto_import) reads
and writes ONLY the gateway tables. The one-time :func:`run_final_conversion`
(startup-only) drains any remaining legacy rows into gateway credentials
and deletes the rows — the table itself is never dropped (user data
safety). If the conversion fails, rows are kept and the
:func:`conversion_failed` flag returns True so a future boot can retry.

Mapping decisions (see plan §L2):

- ``id`` (int) → deterministic 31-bit hash of the Credential UUID string.
  Stable across restarts; resolved back to the UUID by scanning
  credentials (small N, no extra storage needed).
- ``provider`` → ``ProviderEndpoint.name`` (display name) +
  ``adapter_type`` (resolved via ``_adapter_type_for_provider``).
- ``name`` → stored as a plain human-readable string in ``Credential.label``.
- ``apiKey``/``oauthToken``/``sessionToken`` → ``CredentialSecret.secret_value``
  (first non-empty wins, same priority as ``migration._pick_account_secret``).
- ``auth_type`` → ``Credential.auth_type`` (``api_key`` | ``oauth`` | ``session``).
- ``enabled`` → ``Credential.enabled``.
- ``oauthRefreshToken`` → ``CredentialSecret.refresh_token``.
- ``oauthExpiresAt`` → ``CredentialSecret.expires_at``.
- ``lastUsedAt`` → ``Credential.last_success_at`` (unix ts ↔ datetime).
- ``createdAt`` / ``updatedAt`` → ``Credential.created_at`` / ``updated_at``.

Imperfect fields with no 1:1 gateway column are stored in the
``Credential.legacy_metadata`` JSON column (lossless round-trip):

  ``accountType``, ``softQuotaTokensDaily``, ``softQuotaRequestsDaily``,
  ``oauthScopes``, ``oauthTokenType``, ``refCode``, ``refUrl``,
  ``refUsedCount``, ``refMaxCount``, ``referredById``

Runtime counters (``requestsToday``, ``requestsTotal``, ``tokensUsed``)
are zero-filled on read — the gateway tracks runtime state separately
via ``Credential.runtime_status`` etc.

A startup conversion (``convert_legacy_labels``) migrates rows whose
``label`` still contains the old JSON-in-label format (a dict with key
``'name'``) to the new split: ``label = dict['name']``,
``legacy_metadata = {**rest}``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
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
    ProviderEndpointService,
    compute_fingerprint,
)

logger = logging.getLogger(__name__)

# ── Adapter type mapping (mirrors KeyHealthWorker._adapter_type_for_provider) ──

_ADAPTER_MAP: dict[str, str] = {
    "anthropic": "anthropic",
    "gemini": "gemini",
}

# Default base URLs for built-in providers (mirrors KeyHealthWorker + commands).
_BASE_URL_MAP: dict[str, str] = {
    "openai": "https://api.openai.com",
    "antigravity": "https://api.openai.com",
    "fireworks": "https://api.fireworks.ai/inference",
    "dashscope": "https://dashscope.aliyuncs.com/compatible-mode",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
    "anthropic": "https://api.anthropic.com",
}


def _adapter_type_for_provider(provider: str) -> str:
    return _ADAPTER_MAP.get(provider, "openai_compatible")


def _default_base_url(provider: str) -> str:
    return _BASE_URL_MAP.get(provider, f"https://unknown-base-url.invalid/{provider}")


def _display_name(provider: str) -> str:
    return provider.replace("_", " ").strip().title() or provider


# ── ID mapping: deterministic int hash of Credential UUID ────────────────────


def _legacy_id(credential_id: str) -> int:
    """Deterministic 31-bit positive int from a Credential UUID.

    Used as the ``id`` field in legacy AiProxyAccount responses so the
    frontend can pass it back to update/delete. Resolved by scanning
    credentials (small N) — see :func:`_find_credential_by_legacy_id`.
    """
    h = hashlib.sha256(credential_id.encode()).hexdigest()
    return int(h[:8], 16) & 0x7FFFFFFF


async def _find_credential_by_legacy_id(
    session: Any, legacy_id: int
) -> Credential | None:
    """Scan credentials for one whose hash matches *legacy_id*."""
    result = await session.execute(select(Credential))
    for cred in result.scalars().all():
        if _legacy_id(cred.id) == legacy_id:
            return cred
    return None


# ── Legacy metadata: stores imperfect legacy fields ─────────────────────────
#
# ``name`` lives in ``Credential.label`` as a plain string.
# Everything else with no 1:1 gateway column lives in
# ``Credential.legacy_metadata`` (JSON dict) so export/import is lossless.

_METADATA_FIELDS: tuple[str, ...] = (
    "accountType",
    "softQuotaTokensDaily",
    "softQuotaRequestsDaily",
    "oauthScopes",
    "oauthTokenType",
    "refCode",
    "refUrl",
    "refUsedCount",
    "refMaxCount",
    "referredById",
)


def _encode_metadata(account: dict[str, Any]) -> dict[str, Any]:
    """Pack legacy fields with no 1:1 gateway column into a metadata dict."""
    payload: dict[str, Any] = {}
    for key in _METADATA_FIELDS:
        val = account.get(key)
        if val is not None:
            payload[key] = val
    return payload


def _decode_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    """Unpack the metadata dict back into a dict of legacy fields."""
    if not metadata:
        return {}
    return dict(metadata) if isinstance(metadata, dict) else {}


# ── Old JSON-in-label backward compat (read-only, for migration) ───────────


def _decode_old_label(label: str | None) -> dict[str, Any]:
    """Decode the old JSON-in-label format (pre-P0.2).

    Before P0.2, all imperfect fields (including ``name``) were packed
    into ``Credential.label`` as a JSON dict.  This decodes that format
    so the startup conversion can split it into ``label`` + ``legacy_metadata``.
    """
    if not label:
        return {}
    try:
        data = json.loads(label)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


# ── Secret selection (same priority as migration._pick_account_secret) ──────


def _pick_secret(account: dict[str, Any]) -> tuple[str | None, str]:
    """Return (secret, auth_type) — first non-empty of apiKey/oauth/session."""
    api_key = account.get("apiKey") or account.get("api_key")
    if api_key:
        return api_key, "api_key"
    oauth = account.get("oauthToken") or account.get("oauth_token")
    if oauth:
        return oauth, "oauth"
    session_tok = account.get("sessionToken") or account.get("session_token")
    if session_tok:
        return session_tok, "session"
    return None, ""


# ── Timestamp conversion ────────────────────────────────────────────────────


def _dt_to_ts(dt: datetime | None) -> int | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        # SQLite strips tzinfo on persist; stored wall time is UTC.  Without
        # this, .timestamp() would interpret the naive value as LOCAL time
        # and drift by the local UTC offset on every round-trip.
        dt = dt.replace(tzinfo=UTC)
    return int(dt.timestamp())


def _ts_to_dt(ts: int | None) -> datetime | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=UTC)


# ── Endpoint resolution ──────────────────────────────────────────────────────


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
        return existing

    svc = ProviderEndpointService(session)
    endpoint = await svc.create_endpoint(
        name=name,
        adapter_type=_adapter_type_for_provider(provider),
        base_url=url,
        enabled=True,
        owner_id=owner_id,
    )
    return endpoint


# ── Row → legacy account dict ────────────────────────────────────────────────


async def _credential_to_account(
    session: Any,
    credential: Credential,
    endpoint: ProviderEndpoint | None = None,
    secret_row: CredentialSecret | None = None,
) -> dict[str, Any]:
    """Map a Credential row back to the legacy AiProxyAccount dict shape."""
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

    # Read name from label (plain string in the new format).
    # Fall back to old JSON-in-label format for un-migrated rows.
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
        # None-safe reads: `or` would coerce a stored 0 back to the default
        # (refMaxCount=0 used to read back as 40).
        "refUsedCount": metadata["refUsedCount"] if metadata.get("refUsedCount") is not None else 0,
        "refMaxCount": metadata["refMaxCount"] if metadata.get("refMaxCount") is not None else 40,
        "referredById": metadata.get("referredById"),
    }


# ── Public CRUD API ──────────────────────────────────────────────────────────


async def list_accounts(session: Any, owner_id: int | None = None) -> list[dict[str, Any]]:
    """Return all credentials visible to *owner_id* as legacy account dicts."""
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
        acct = await _credential_to_account(session, cred)
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
        # No secret — still create a credential with an empty placeholder
        # so the row exists (matches legacy behavior where accounts could
        # have no secret). Use a sentinel that won't be returned.
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

    # Store legacy_metadata on the newly created credential; honour the
    # legacy `enabled` flag (create_credential defaults to True).
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


# ── Export / Import (lossless round-trip) ────────────────────────────────────


async def export_payload(
    session: Any, fmt: str = "json", include_secrets: bool = False
) -> str:
    """Produce a JSON/CSV payload preserving every legacy field (lossless)."""
    from datetime import datetime as _dt

    accounts = await list_accounts(session)
    export_rows: list[dict[str, Any]] = []
    for a in accounts:
        row: dict[str, Any] = {
            "provider": a["provider"],
            "name": a["name"],
            "enabled": a["enabled"],
            "accountType": a["accountType"],
            "softQuotaTokensDaily": a["softQuotaTokensDaily"],
            "softQuotaRequestsDaily": a["softQuotaRequestsDaily"],
            "oauthScopes": a["oauthScopes"],
            "oauthTokenType": a["oauthTokenType"],
            "refCode": a["refCode"],
            "refUrl": a["refUrl"],
            "refUsedCount": a["refUsedCount"],
            "refMaxCount": a["refMaxCount"],
            "referredById": a["referredById"],
        }
        if include_secrets:
            row["oauthToken"] = a["oauthToken"]
            row["apiKey"] = a["apiKey"]
            row["sessionToken"] = a["sessionToken"]
            row["oauthRefreshToken"] = a["oauthRefreshToken"]
            row["oauthExpiresAt"] = a["oauthExpiresAt"]
        export_rows.append(row)

    payload = {
        "version": 1,
        "exportedAt": _dt.now(UTC).isoformat(),
        "includeSecrets": include_secrets,
        "accounts": export_rows,
    }

    if fmt.lower() == "csv":
        lines = ["provider,name,enabled,account_type"]
        for a in export_rows:
            lines.append(
                f'"{a["provider"]}","{a["name"]}",{1 if a["enabled"] else 0},"{a.get("accountType", "")}"'
            )
        return "\n".join(lines)

    return json.dumps(payload, indent=2)


async def import_payload(session: Any, payload_str: str) -> int:
    """Import a legacy payload into gateway tables (dedupe by provider+name).

    Lossless: every field in the payload rows is preserved via
    ``legacy_metadata``.
    """
    data = json.loads(payload_str)
    accounts = data.get("accounts", [])
    existing = await list_accounts(session)
    existing_keys = {
        f"{a['provider'].lower()}::{a['name'].lower()}" for a in existing
    }

    imported = 0
    for row in accounts:
        provider = row.get("provider", "").lower()
        name = row.get("name", "")
        dedupe_key = f"{provider}::{name.lower()}"
        if dedupe_key in existing_keys:
            continue
        account = {
            "provider": provider,
            "name": name,
            "enabled": row.get("enabled", True),
            "accountType": row.get("accountType"),
            "softQuotaTokensDaily": row.get("softQuotaTokensDaily"),
            "softQuotaRequestsDaily": row.get("softQuotaRequestsDaily"),
            "oauthScopes": row.get("oauthScopes"),
            "oauthTokenType": row.get("oauthTokenType"),
            "refCode": row.get("refCode"),
            "refUrl": row.get("refUrl"),
            "refUsedCount": row.get("refUsedCount"),
            "refMaxCount": row.get("refMaxCount"),
            "referredById": row.get("referredById"),
            "oauthToken": row.get("oauthToken"),
            "apiKey": row.get("apiKey"),
            "sessionToken": row.get("sessionToken"),
            "oauthRefreshToken": row.get("oauthRefreshToken"),
            "oauthExpiresAt": row.get("oauthExpiresAt"),
        }
        await create_account(session, account)
        existing_keys.add(dedupe_key)
        imported += 1
    return imported


# ── Startup conversion: old JSON-in-label → label + legacy_metadata ─────────


async def convert_legacy_labels(session: Any) -> int:
    """Migrate Credential rows whose ``label`` is a JSON dict with key ``name``.

    Pre-P0.2, all imperfect legacy fields (including ``name``) were packed
    into ``Credential.label`` as a JSON dict.  P0.2 splits them: ``label``
    holds the plain name string, ``legacy_metadata`` holds the rest.

    Idempotent — rows already in the new format (plain string label, or
    label that doesn't parse as a JSON dict with ``name``) are skipped.
    Returns the number of rows converted.
    """
    result = await session.execute(select(Credential))
    converted = 0
    for cred in result.scalars().all():
        if not cred.label:
            continue
        old_data = _decode_old_label(cred.label)
        if not old_data or "name" not in old_data:
            continue
        # Split: label = name, legacy_metadata = {**rest}
        name = old_data.get("name", "")
        extras = {k: v for k, v in old_data.items() if k != "name"}
        cred.label = name
        if extras:
            # Merge into any existing legacy_metadata.
            existing_meta = _decode_metadata(cred.legacy_metadata)
            existing_meta.update(extras)
            cred.legacy_metadata = existing_meta
        cred.updated_at = datetime.now(UTC)
        converted += 1
    if converted:
        await session.flush()
        logger.info("Legacy label conversion: %d rows migrated to legacy_metadata", converted)
    return converted


# ── L2 final wave: one-time legacy row drain ──────────────────────────────────


_conversion_failed: bool = False


def conversion_failed() -> bool:
    """True if the final conversion failed — aliases still work over gateway tables."""
    return _conversion_failed


async def run_final_conversion(session: Any) -> dict[str, int]:
    """FINAL one-time conversion: ``ai_proxy_accounts`` → ai_gateway credentials.

    Idempotent — safe to call on every boot. If the legacy table exists and
    has rows:

    1. Read rows via :class:`AiProxyAccountStore.get_accounts` (conversion-only
       path — ``_ensure_table`` is kept for this path per task spec).
    2. Convert each row via :func:`create_account` (this module's create path,
       which dedupes by fingerprint via ``CredentialService.create_credential``).
    3. On success: ``DELETE FROM ai_proxy_accounts`` — the table stays
       empty/inert, NEVER dropped (user data safety).
    4. On failure: warn + keep rows + set ``_conversion_failed`` flag so a
       future boot can retry. Aliases keep working over gateway tables.

    Returns a counts dict.
    """
    global _conversion_failed

    from sqlalchemy import text as _text

    # Check if the legacy table exists via PRAGMA (no _ensure_table call here —
    # if the table doesn't exist, there's nothing to convert).
    try:
        result = await session.execute(_text("PRAGMA table_info(ai_proxy_accounts)"))
        if not result.fetchall():
            return {"legacy_rows": 0, "converted": 0, "deleted": 0}
    except Exception:
        return {"legacy_rows": 0, "converted": 0, "deleted": 0}

    # Count rows.
    count_result = await session.execute(_text("SELECT COUNT(*) FROM ai_proxy_accounts"))
    legacy_count = int(count_result.scalar_one())
    if legacy_count == 0:
        return {"legacy_rows": 0, "converted": 0, "deleted": 0}

    logger.info("Final legacy conversion starting: %d legacy rows", legacy_count)

    # Read rows via AiProxyAccountStore (conversion-only path).
    from stitch_backend.domains.ai_proxy.service import AiProxyAccountStore

    AiProxyAccountStore._TABLE_ENSUREED = False  # reset cache for this session
    accounts = await AiProxyAccountStore.get_accounts(session)

    # Convert each row via create_account (this module's create path).
    try:
        converted = 0
        for account in accounts:
            await create_account(session, account)
            converted += 1

        # Delete the rows on success — table stays empty/inert, never dropped.
        await session.execute(_text("DELETE FROM ai_proxy_accounts"))
        _conversion_failed = False
        logger.info(
            "Final legacy conversion complete: %d legacy rows → %d gateway "
            "credentials, rows deleted (table kept inert)",
            legacy_count, converted,
        )
        return {
            "legacy_rows": legacy_count,
            "converted": converted,
            "deleted": legacy_count,
        }
    except Exception as exc:
        _conversion_failed = True
        logger.warning(
            "Final legacy conversion FAILED (%d rows kept, aliases still "
            "work over gateway tables): %s", legacy_count, exc,
        )
        return {
            "legacy_rows": legacy_count,
            "converted": 0,
            "deleted": 0,
            "error": str(exc),
        }
