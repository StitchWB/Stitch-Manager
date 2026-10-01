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

import json
import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select

from stitch_backend.domains.ai_gateway.models import Credential
from stitch_backend.domains.ai_proxy.legacy_authz import (
    _caller_can_modify_credential,
    caller_can_delete_credential,
)
from stitch_backend.domains.ai_proxy.legacy_crud import (
    create_account,
    delete_account,
    get_account_by_name,
    list_accounts,
    update_account,
)
from stitch_backend.domains.ai_proxy.legacy_mapping import (
    _decode_metadata,
    _decode_old_label,
    _find_credential_by_legacy_id,
    _legacy_id,
    _mask_secret,
)

__all__ = [
    "caller_can_delete_credential",
    "conversion_failed",
    "convert_legacy_labels",
    "create_account",
    "delete_account",
    "export_payload",
    "get_account_by_name",
    "import_payload",
    "list_accounts",
    "run_final_conversion",
    "update_account",
    "_caller_can_modify_credential",
    "_find_credential_by_legacy_id",
    "_legacy_id",
    "_mask_secret",
]

logger = logging.getLogger(__name__)


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

    P1.10: honours the envelope ``includeSecrets`` flag — when False,
    secret fields (``apiKey``, ``oauthToken``, ``sessionToken``,
    ``oauthRefreshToken``, ``oauthExpiresAt``) are skipped during
    import, matching the export side's ``include_secrets`` gate.
    """
    data = json.loads(payload_str)
    accounts = data.get("accounts", [])
    envelope_include_secrets = bool(data.get("includeSecrets", True))
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
        }
        if envelope_include_secrets:
            account["oauthToken"] = row.get("oauthToken")
            account["apiKey"] = row.get("apiKey")
            account["sessionToken"] = row.get("sessionToken")
            account["oauthRefreshToken"] = row.get("oauthRefreshToken")
            account["oauthExpiresAt"] = row.get("oauthExpiresAt")
        await create_account(session, account)
        existing_keys.add(dedupe_key)
        imported += 1
    return imported


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


_conversion_failed: bool = False


def conversion_failed() -> bool:
    """True if the final conversion failed — aliases still work over gateway tables."""
    return _conversion_failed


async def run_final_conversion(session: Any) -> dict[str, Any]:
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

    try:
        result = await session.execute(_text("PRAGMA table_info(ai_proxy_accounts)"))
        if not result.fetchall():
            return {"legacy_rows": 0, "converted": 0, "deleted": 0}
    except Exception:
        return {"legacy_rows": 0, "converted": 0, "deleted": 0}

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
        converted_ids: list[int] = []
        for account in accounts:
            try:
                legacy_id = account.get("id")
                await create_account(session, account)
                converted += 1
                if legacy_id is not None:
                    converted_ids.append(int(legacy_id))
            except Exception as row_exc:
                logger.warning(
                    "Final legacy conversion: row id=%s failed: %s "
                    "(remaining unconverted: %d)",
                    legacy_id, row_exc, len(accounts) - converted - 1,
                )
        if converted_ids:
            logger.info(
                "Final legacy conversion: converted row ids: %s",
                converted_ids,
            )

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
        remaining = legacy_count - converted
        logger.warning(
            "Final legacy conversion FAILED (%d rows kept, %d remaining "
            "unconverted, aliases still work over gateway tables): %s",
            legacy_count, remaining, exc,
        )
        return {
            "legacy_rows": legacy_count,
            "converted": 0,
            "deleted": 0,
            "error": str(exc),
        }
