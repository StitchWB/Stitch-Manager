"""One-time, idempotent backfill of ``ai_gateway_*`` tables from legacy sources.

This module is purely ADDITIVE: it never deletes or mutates rows in the
legacy tables (``ai_proxy_accounts``, ``ai_proxy_settings`` / the per-provider
``*_api_keys`` rows within it, or ``custom_providers_v1``). It only reads from
them and creates/looks-up rows in the new ``ai_gateway_*`` tables so a future
stage can gradually switch reads over to the unified schema.

Legacy sources migrated in this pass:

1. ``ai_proxy_accounts`` (via ``AiProxyAccountStore.get_accounts``) — one
   secret per account: ``apiKey`` > ``oauthToken`` > ``sessionToken``
   (first non-empty wins). Accounts with no usable secret are skipped.
2. ``ai_proxy_settings.<provider>_api_keys`` (via ``ApiKeysService.get_keys``)
   for every provider in ``PROVIDER_DB_KEYS`` — always ``auth_type="api_key"``.
3. ``custom_providers_v1`` (via ``get_custom_providers``) plus each custom
   provider's own key array (via ``ApiKeysService.get_keys_by_db_key``).

KNOWN SCOPE BOUNDARY — read before touching this file
-------------------------------------------------------
This migration intentionally does **not** populate ``UpstreamModel`` or
``CredentialModelAccess``. None of the three legacy sources carry real
per-model granularity — they represent wildcard ``provider/*`` deployments
today (see ``litellm_gateway.py::_LITELLM_PROVIDER_MODELS``), so there is no
static data here from which to derive genuine upstream model IDs. Fabricating
placeholder ``UpstreamModel`` rows from guesses would poison the catalog with
data that was never actually verified against a live endpoint. Populating
those tables requires live discovery via an adapter's ``list_models`` (or
equivalent probe) — that is a separate, future action, not a data migration,
and is explicitly out of scope for this pass.

Endpoint idempotency
---------------------
Rather than depend on a specific lookup-helper name on ``ProviderEndpointService``
(which may not match exactly once the parallel CRUD-layer agent's work lands),
this migration queries ``ProviderEndpoint`` directly via SQLAlchemy
``select(...).where(name=..., base_url=...)`` before creating a new row. This
keeps the migration decoupled from a helper method signature that isn't
guaranteed yet.

Credential idempotency is delegated to ``CredentialService.create_credential``,
which is documented (per the cross-agent contract) to dedupe by fingerprint
(sha256 of endpoint_id + secret) and return the existing row rather than
create a duplicate. This migration does NOT reimplement that logic inline.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from stitch_backend.domains.ai_gateway.models import Credential, ProviderEndpoint
from stitch_backend.domains.ai_gateway.service import (
    CredentialService,
    UpstreamModelService,  # noqa: F401  (imported per contract; not used in this pass — see docstring)
    compute_fingerprint,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Adapter tag applied to every endpoint created by this migration pass. None
# of the legacy sources have protocol-specific adapters yet; the existing
# native gateway already treats everything as OpenAI-shaped, so this is an
# accurate reflection of current behavior, not a simplification.
_ADAPTER_TYPE = "openai_compatible"


async def migrate_legacy_credentials(session: AsyncSession) -> dict[str, Any]:
    """Backfill ``ai_gateway_provider_endpoints`` / ``credentials`` /
    ``credential_secrets`` from the three legacy credential sources.

    Read-only against legacy tables. Safe to call multiple times — re-running
    only increases the "existing"/"deduped" counters, it never creates
    duplicate endpoints or credentials.

    Does NOT touch ``UpstreamModel`` or ``CredentialModelAccess`` — see the
    module docstring's "KNOWN SCOPE BOUNDARY" section for why.

    Returns a dict of counters, e.g.::

        {
            "endpoints_created": 3,
            "endpoints_existing": 1,
            "credentials_created": 12,
            "credentials_existing_deduped": 2,
            "sources_scanned": {
                "ai_proxy_accounts": 5,
                "api_keys": 8,
                "custom_providers": 2,
            },
        }
    """
    counters: dict[str, Any] = {
        "endpoints_created": 0,
        "endpoints_existing": 0,
        "credentials_created": 0,
        "credentials_existing_deduped": 0,
        "sources_scanned": {
            "ai_proxy_accounts": 0,
            "api_keys": 0,
            "custom_providers": 0,
        },
    }

    credential_service = CredentialService(session)

    await _migrate_ai_proxy_accounts(session, credential_service, counters)
    await _migrate_api_keys(session, credential_service, counters)
    await _migrate_custom_providers(session, credential_service, counters)

    return counters


# ── Source 1: ai_proxy_accounts ─────────────────────────────────────────────

async def _migrate_ai_proxy_accounts(
    session: AsyncSession,
    credential_service: CredentialService,
    counters: dict[str, Any],
) -> None:
    from stitch_backend.domains.ai_proxy.service import AiProxyAccountStore

    accounts = await AiProxyAccountStore.get_accounts(session)
    counters["sources_scanned"]["ai_proxy_accounts"] = len(accounts)

    for account in accounts:
        # Skip disabled accounts — don't migrate revoked/disabled keys as enabled credentials
        if not account.get("enabled", True):
            continue

        secret, auth_type = _pick_account_secret(account)
        if not secret:
            continue  # no usable secret — skip per spec

        provider = str(account.get("provider") or "").strip()
        if not provider:
            continue

        base_url = _default_base_url_for(provider)
        endpoint = await _get_or_create_endpoint(
            session,
            name=_display_name_for(provider),
            base_url=base_url,
            counters=counters,
        )

        name = account.get("name") or ""
        await _create_credential_tracked(
            session,
            credential_service,
            counters,
            provider_endpoint_id=endpoint.id,
            label=f"migrated from ai_proxy_accounts: {name}",
            auth_type=auth_type,
            secret=secret,
        )


def _pick_account_secret(account: dict[str, Any]) -> tuple[str | None, str]:
    """First non-empty of apiKey > oauthToken > sessionToken wins."""
    api_key = account.get("apiKey")
    if api_key:
        return api_key, "api_key"
    oauth_token = account.get("oauthToken")
    if oauth_token:
        return oauth_token, "oauth"
    session_token = account.get("sessionToken")
    if session_token:
        return session_token, "session"
    return None, ""


# ── Source 2: ai_proxy_settings.*_api_keys ──────────────────────────────────

async def _migrate_api_keys(
    session: AsyncSession,
    credential_service: CredentialService,
    counters: dict[str, Any],
) -> None:
    from stitch_backend.domains.api_keys.schemas import PROVIDER_DB_KEYS
    from stitch_backend.domains.api_keys.service import ApiKeysService

    svc = ApiKeysService(session)
    scanned = 0

    for provider in PROVIDER_DB_KEYS:
        keys = await svc.get_keys(provider)
        scanned += len(keys)

        for key_info in keys:
            secret = key_info.get("apiKey")
            if not secret:
                continue

            base_url = key_info.get("baseUrl") or _default_base_url_for(provider)
            endpoint = await _get_or_create_endpoint(
                session,
                name=_display_name_for(provider),
                base_url=base_url,
                counters=counters,
            )

            await _create_credential_tracked(
                session,
                credential_service,
                counters,
                provider_endpoint_id=endpoint.id,
                label=f"migrated from api_keys: {provider}",
                auth_type="api_key",
                secret=secret,
            )

    counters["sources_scanned"]["api_keys"] = scanned


# ── Source 3: custom_providers_v1 ───────────────────────────────────────────

async def _migrate_custom_providers(
    session: AsyncSession,
    credential_service: CredentialService,
    counters: dict[str, Any],
) -> None:
    from stitch_backend.domains.api_keys.custom_providers import (
        custom_provider_db_key,
        get_custom_providers,
    )
    from stitch_backend.domains.api_keys.service import ApiKeysService

    providers = await get_custom_providers(session)
    counters["sources_scanned"]["custom_providers"] = len(providers)

    svc = ApiKeysService(session)

    for provider in providers:
        db_key = custom_provider_db_key(provider.id)
        keys = await svc.get_keys_by_db_key(db_key)

        for key_info in keys:
            secret = key_info.get("apiKey")
            if not secret:
                continue

            # Each key may have a different baseUrl — resolve per-key
            # to avoid collapsing distinct endpoints into one.
            base_url = key_info.get("baseUrl") or provider.base_url
            endpoint = await _get_or_create_endpoint(
                session,
                name=provider.name,
                base_url=base_url,
                counters=counters,
            )

            await _create_credential_tracked(
                session,
                credential_service,
                counters,
                provider_endpoint_id=endpoint.id,
                label=f"migrated from custom_providers: {provider.name}",
                auth_type="api_key",
                secret=secret,
            )


# ── Shared helpers ───────────────────────────────────────────────────────────

def _display_name_for(provider: str) -> str:
    """User-facing endpoint name for a built-in provider id."""
    return provider.replace("_", " ").strip().title() or provider


def _default_base_url_for(provider: str) -> str:
    """Resolve a default base URL for a built-in provider.

    Delegates to ``KeyHealthWorker._default_base_url`` (the single source of
    truth for these URL literals elsewhere in the codebase) and falls back to
    a generic placeholder for providers that helper doesn't know about
    (e.g. ``qoder``, ``zai`` — not present in that mapping today) so the
    migration never crashes on an unmapped provider.
    """
    from stitch_backend.domains.key_health.worker import KeyHealthWorker

    url = KeyHealthWorker._default_base_url(provider)
    if url:
        return url
    # Not every provider in PROVIDER_DB_KEYS has an entry in the KeyHealthWorker
    # mapping (e.g. qoder, zai). Use a clearly-a-placeholder URL so it's obvious
    # in the data that no real base URL was known at migration time — a real
    # base_url from a stored key (if any) always takes precedence over this,
    # see call sites above.
    return f"https://unknown-base-url.invalid/{provider}"


async def _get_or_create_endpoint(
    session: AsyncSession,
    *,
    name: str,
    base_url: str,
    counters: dict[str, Any],
) -> ProviderEndpoint:
    """Defensive idempotent lookup-or-create for ``ProviderEndpoint``.

    Queries directly via SQLAlchemy rather than a service helper method,
    since this migration cannot depend on an exact helper name/signature
    existing on ``ProviderEndpointService`` yet.
    """
    result = await session.execute(
        select(ProviderEndpoint).where(
            ProviderEndpoint.name == name,
            ProviderEndpoint.base_url == base_url,
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        counters["endpoints_existing"] += 1
        return existing

    endpoint = ProviderEndpoint(
        name=name,
        adapter_type=_ADAPTER_TYPE,
        base_url=base_url,
        enabled=True,
    )
    session.add(endpoint)
    await session.flush()  # assign PK without committing the outer transaction
    counters["endpoints_created"] += 1
    return endpoint


async def _create_credential_tracked(
    session: AsyncSession,
    credential_service: CredentialService,
    counters: dict[str, Any],
    *,
    provider_endpoint_id: str,
    label: str,
    auth_type: str,
    secret: str,
) -> None:
    """Call ``CredentialService.create_credential`` and bucket the result
    into "created" vs "existing_deduped".

    ``create_credential`` is documented to be idempotent by fingerprint and
    return the *existing* row on a repeat call rather than raise or duplicate.
    To report accurate counters without requiring the service to expose any
    extra "was_created" signal beyond the documented contract, we do a cheap
    pre-check directly against the ``ai_gateway_credentials`` table for a row
    with the fingerprint ``compute_fingerprint`` produces (the same helper
    ``create_credential`` itself uses internally) — the same defensive-query
    pattern used for ``ProviderEndpoint`` idempotency above. The actual
    create/dedup decision always happens inside the real service call; this
    pre-check is purely for bookkeeping.
    """
    fingerprint = compute_fingerprint(provider_endpoint_id, secret)
    result = await session.execute(
        select(Credential.id).where(Credential.fingerprint == fingerprint)
    )
    existed_before = result.scalar_one_or_none() is not None

    await credential_service.create_credential(
        provider_endpoint_id=provider_endpoint_id,
        label=label,
        auth_type=auth_type,
        secret=secret,
    )

    if existed_before:
        counters["credentials_existing_deduped"] += 1
    else:
        counters["credentials_created"] += 1
