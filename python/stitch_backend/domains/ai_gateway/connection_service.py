"""Transactional save of one connection: endpoint match-or-create + all keys.

Runs entirely on the caller's write session (the ``@command`` dispatcher
owns the single write connection — a nested ``run_in_session`` here would
deadlock the pool).  Flushes only; the dispatcher commits, so any raised
error rolls endpoint and keys back together.

Saving never schedules probes and never touches the network: the SSRF DNS
check inside ``SaveConnectionRequest.validate_base_url`` is the only
resolution performed, and optional connectivity checks are separate
commands (``test_credential_connection`` / ``discover_models_for_endpoint``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import and_, select

from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.ai_gateway.adapters.base import get_adapter_capabilities
from stitch_backend.domains.ai_gateway.credential_service import compute_fingerprint
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialSecret,
    ProviderEndpoint,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.schemas import (
    CredentialResponse,
    SaveConnectionRequest,
    SaveConnectionResponse,
)
from stitch_backend.domains.ai_gateway.schemas.endpoints import ProviderEndpointResponse
from stitch_backend.domains.ai_gateway.service import ProviderEndpointService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# Own fingerprint namespace for "none" markers: fp("") collides with legacy empty-api_key rows.
_NONE_AUTH_MARKER = "\x00auth:none"


async def save_connection(
    db: AsyncSession, req: SaveConnectionRequest, owner_id: int | None,
) -> SaveConnectionResponse:
    """Persist endpoint + credentials atomically; dedup on repeat saves."""
    endpoint, endpoint_created = await _resolve_endpoint(db, req, owner_id)
    if req.auth.type == "none" and not get_adapter_capabilities(endpoint.adapter_type).supports_none_auth:
        raise StitchError(
            f"auth.type 'none' is not supported by adapter "
            f"{endpoint.adapter_type!r}"
        )
    if endpoint.adapter_type == "anthropic" and any(
        secret.startswith(("sk-ant-oat", "sk-ant-sid")) for secret in req.auth.secrets or []
    ):
        raise StitchError("Anthropic API-key connections do not accept OAuth or session tokens")

    credentials, created, existing = await _save_credentials(db, req, endpoint, owner_id)
    return SaveConnectionResponse(
        endpoint=ProviderEndpointResponse.from_orm_model(endpoint),
        endpoint_created=endpoint_created,
        credentials=credentials,
        credentials_created=created,
        credentials_existing=existing,
    )


async def _resolve_endpoint(
    db: AsyncSession, req: SaveConnectionRequest, owner_id: int | None,
) -> tuple[ProviderEndpoint, bool]:
    """Return (endpoint, created). An existing endpoint is never mutated."""
    # Lazy: a top-level import would cycle commands/__init__ → save_connection → here.
    from stitch_backend.domains.ai_gateway.commands._common import _owner_filter

    if req.endpoint_id is not None:
        result = await db.execute(
            select(ProviderEndpoint).where(
                and_(
                    ProviderEndpoint.id == req.endpoint_id,
                    _owner_filter(ProviderEndpoint, owner_id),
                )
            )
        )
        endpoint = result.scalar_one_or_none()
        if endpoint is None:
            raise StitchError(f"Provider endpoint not found: {req.endpoint_id}")
        return endpoint, False

    result = await db.execute(
        select(ProviderEndpoint).where(
            and_(
                ProviderEndpoint.base_url == req.base_url,
                ProviderEndpoint.adapter_type == req.adapter_type,
                _owner_filter(ProviderEndpoint, owner_id),
            )
        ).order_by(ProviderEndpoint.created_at.asc())
    )
    matches = list(result.scalars().all())
    if matches:
        own = next((e for e in matches if e.owner_id == owner_id), None)
        return (own or matches[0]), False

    endpoint = await ProviderEndpointService(db).create_endpoint(
        name=req.name or req.base_url or "",
        adapter_type=req.adapter_type or "",
        base_url=req.base_url or "",
        enabled=True if req.enabled is None else req.enabled,
        default_headers=req.default_headers,
        owner_id=owner_id,
    )
    return endpoint, True


async def _save_credentials(
    db: AsyncSession,
    req: SaveConnectionRequest,
    endpoint: ProviderEndpoint,
    owner_id: int | None,
) -> tuple[list[CredentialResponse], int, int]:
    """Create-or-dedup every submitted key in submission order.

    Dedup is by fingerprint (SHA256 of endpoint id + secret) restricted to
    rows visible to the caller; a fingerprint owned by ANOTHER user is a
    hard error — never reused, never duplicated (the unique index forbids
    a second row anyway).  ``none`` markers dedup in their own fingerprint
    namespace (``_NONE_AUTH_MARKER``), so a legacy empty-``api_key``
    placeholder row is never adopted as a ``none`` credential; a
    fingerprint hit whose auth type differs from the request is a hard
    conflict, never a silent wrong-type success.
    """
    auth_type = req.auth.type
    secrets = [""] if auth_type == "none" else list(req.auth.secrets or [])

    responses: list[CredentialResponse] = []
    created = 0
    existing = 0
    for secret in secrets:
        fp_secret = _NONE_AUTH_MARKER if auth_type == "none" else secret
        fingerprint = compute_fingerprint(endpoint.id, fp_secret)
        result = await db.execute(
            select(Credential).where(Credential.fingerprint == fingerprint)
        )
        found = result.scalar_one_or_none()
        if found is not None:
            if not _visible_to(found, owner_id):
                raise StitchError(
                    "this authorization is already registered by "
                    "another user for this endpoint"
                )
            if found.auth_type != auth_type:
                raise StitchError(
                    f"auth type conflict: this key is already saved on the "
                    f"endpoint with auth_type {found.auth_type!r} — re-saving "
                    f"it as {auth_type!r} is not supported"
                )
            responses.append(CredentialResponse.from_orm_model(found))
            existing += 1
            continue

        credential = Credential(
            provider_endpoint_id=endpoint.id,
            label=None,
            auth_type=auth_type,
            fingerprint=fingerprint,
            enabled=True,
            runtime_status="unknown",
            owner_id=owner_id,
            created_at=_utcnow(),
        )
        db.add(credential)
        await db.flush()
        if auth_type != "none":
            db.add(CredentialSecret(
                credential_id=credential.id,
                secret_value=secret,
                secret_type="api_key",
                created_at=_utcnow(),
            ))
            await db.flush()
        responses.append(CredentialResponse.from_orm_model(credential))
        created += 1

    return responses, created, existing


def _visible_to(credential: Credential, owner_id: int | None) -> bool:
    return credential.owner_id is None or credential.owner_id == owner_id
