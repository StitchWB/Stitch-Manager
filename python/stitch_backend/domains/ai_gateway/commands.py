"""AI Gateway command handlers — registered via ``@register_command``.

Full CRUD for every entity in the domain (``ProviderEndpoint``,
``Credential``, ``UpstreamModel``, ``CredentialModelAccess``,
``PublicModel``, ``RouteTarget``), plus the two special ``Credential``
actions (``rotate_credential_secret`` and the underlying invocation-secret
access, which is intentionally NOT exposed as a command — see
``CredentialService.get_secret_for_invocation`` docstring).

Every handler validates ``params`` through the matching Pydantic request
schema (``model_validate(params)``) then performs the DB operation via
``run_in_session(...)``, matching the pattern in
``domains/key_health/commands.py``.
"""

from __future__ import annotations

import logging
from typing import Any, cast

from sqlalchemy import and_, func, or_, select

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import get_adapter
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error
from stitch_backend.domains.ai_gateway.discovery_worker import DiscoveryWorker
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialGroupShare,
    ProviderEndpoint,
    PublicModel,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.schemas import (
    CredentialCreateRequest,
    CredentialIdRequest,
    CredentialModelAccessIdRequest,
    CredentialModelAccessResponse,
    CredentialModelAccessUpsertRequest,
    CredentialResponse,
    CredentialUpdateRequest,
    GatewayClaimLegacyRequest,
    GatewaySetInstanceSharedRequest,
    ListCredentialModelAccessRequest,
    ListCredentialsRequest,
    ListRouteTargetsForPublicModelRequest,
    ListUpstreamModelsRequest,
    ProviderEndpointCreateRequest,
    ProviderEndpointIdRequest,
    ProviderEndpointResponse,
    ProviderEndpointUpdateRequest,
    ProxyKeyCreatedResponse,
    ProxyKeyCreateRequest,
    ProxyKeyListResponse,
    ProxyKeyPoolGroupEntry,
    ProxyKeyResponse,
    ProxyKeyRevokeRequest,
    PublicModelCreateRequest,
    PublicModelIdRequest,
    PublicModelResponse,
    PublicModelUpdateRequest,
    RotateCredentialSecretRequest,
    RouteTargetCreateRequest,
    RouteTargetIdRequest,
    RouteTargetResponse,
    RouteTargetUpdateRequest,
    UpstreamModelCreateRequest,
    UpstreamModelIdRequest,
    UpstreamModelResponse,
    UpstreamModelUpdateRequest,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialModelAccessService,
    CredentialService,
    ProviderEndpointService,
    PublicModelService,
    RouteTargetService,
    UpstreamModelService,
    UserProxyKeyService,
)

# NOTE: ``Group`` and ``GroupMember`` are NOT imported at top level — that
# would re-create the ``ai_gateway → groups`` import edge.  They are
# lazy-imported inside the few command handlers that need them.

logger = logging.getLogger(__name__)


# ── Owner-isolation helpers (mirrors domains/accounts & email_inbox) ─────────

def _caller_uid(params: dict) -> int | None:
    """Extract the caller's user ID (None when auth disabled / desktop)."""
    return params.get("_caller_user_id")


def _owner_filter(model, uid: int | None):
    """WHERE clause: owner_id IS NULL OR owner_id = uid (legacy shared pool)."""
    return or_(model.owner_id.is_(None), model.owner_id == uid)


def _mask_proxy_key_hash(token_hash: str) -> str:
    """Mask a proxy key hash for display: first4+****+last4.

    The raw key is never stored (only its SHA256), so the hash is used as
    a fingerprint for identification — the raw key itself is shown ONCE at
    creation time and never again.
    """
    if len(token_hash) < 8:
        return "****"
    return token_hash[:4] + "****" + token_hash[-4:]


def _gateway_base_url() -> str:
    """The gateway base URL the app advertises to clients."""
    from stitch_backend.config import get_settings

    settings = get_settings()
    return f"http://127.0.0.1:{settings.port}{settings.litellm_gateway_model_prefix}"


# ═══════════════════════════════════════════════════════════════════════════
# ProviderEndpoint
# ═══════════════════════════════════════════════════════════════════════════


@register_command("create_provider_endpoint")
async def cmd_create_provider_endpoint(params: dict) -> dict:
    req = ProviderEndpointCreateRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        svc = ProviderEndpointService(session)
        endpoint = await svc.create_endpoint(
            name=req.name,
            adapter_type=req.adapter_type,
            base_url=req.base_url,
            enabled=req.enabled,
            default_headers=req.default_headers,
            discovery_policy=req.discovery_policy,
            health_policy=req.health_policy,
            owner_id=owner_id,
        )
        return ProviderEndpointResponse.from_orm_model(endpoint)

    return await run_in_session(_op)


@register_command("list_provider_endpoints", readonly=True)
async def cmd_list_provider_endpoints(params: dict) -> list[dict]:
    owner_id = _caller_uid(params)

    async def _op(session):
        svc = ProviderEndpointService(session)
        endpoints = await svc.list_endpoints(owner_id=owner_id)
        return [ProviderEndpointResponse.from_orm_model(e) for e in endpoints]

    return await run_in_read_session(_op)


@register_command("get_provider_endpoint", readonly=True)
async def cmd_get_provider_endpoint(params: dict) -> dict | None:
    req = ProviderEndpointIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        result = await session.execute(
            select(ProviderEndpoint).where(
                and_(
                    ProviderEndpoint.id == req.id,
                    _owner_filter(ProviderEndpoint, owner_id),
                )
            )
        )
        endpoint = result.scalar_one_or_none()
        return ProviderEndpointResponse.from_orm_model(endpoint) if endpoint else None

    return await run_in_read_session(_op)


@register_command("update_provider_endpoint")
async def cmd_update_provider_endpoint(params: dict) -> dict | None:
    req = ProviderEndpointUpdateRequest.model_validate(params)
    updates = req.model_dump(exclude={"id"}, exclude_none=True)
    owner_id = _caller_uid(params)

    async def _op(session):
        result = await session.execute(
            select(ProviderEndpoint).where(
                and_(
                    ProviderEndpoint.id == req.id,
                    _owner_filter(ProviderEndpoint, owner_id),
                )
            )
        )
        endpoint = result.scalar_one_or_none()
        if endpoint is None:
            return None
        for key, value in updates.items():
            if hasattr(endpoint, key):
                setattr(endpoint, key, value)
        if hasattr(endpoint, "updated_at"):
            endpoint.updated_at = _utcnow()
        await session.flush()
        await session.refresh(endpoint)
        return ProviderEndpointResponse.from_orm_model(endpoint)

    return await run_in_session(_op)


@register_command("delete_provider_endpoint")
async def cmd_delete_provider_endpoint(params: dict) -> dict:
    req = ProviderEndpointIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        result = await session.execute(
            select(ProviderEndpoint).where(
                and_(
                    ProviderEndpoint.id == req.id,
                    _owner_filter(ProviderEndpoint, owner_id),
                )
            )
        )
        endpoint = result.scalar_one_or_none()
        if endpoint is None:
            return False
        await session.delete(endpoint)
        await session.flush()
        return True

    deleted = await run_in_session(_op)
    return {"success": deleted}


# ═══════════════════════════════════════════════════════════════════════════
# Credential
# ═══════════════════════════════════════════════════════════════════════════


@register_command("create_credential")
async def cmd_create_credential(params: dict) -> dict:
    req = CredentialCreateRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        svc = CredentialService(session)
        credential = await svc.create_credential(
            provider_endpoint_id=req.provider_endpoint_id,
            label=req.label,
            auth_type=req.auth_type,
            secret=req.secret,
            owner_id=owner_id,
        )
        return CredentialResponse.from_orm_model(credential)

    return await run_in_session(_op)


@register_command("list_credentials", readonly=True)
async def cmd_list_credentials(params: dict) -> list[dict]:
    """List credentials visible to the caller with shared-group scope info.

    Single LEFT JOIN aggregate to ``credential_group_shares`` + ``groups``
    populates ``owner_id`` / ``shared_group_ids`` / ``shared_group_names``
    on each item — no N+1.
    """
    req = ListCredentialsRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        # Lazy import — avoids a top-level ``ai_gateway → groups`` edge.
        from stitch_backend.domains.groups.models import Group

        stmt = (
            select(Credential, Group.id, Group.name)
            .select_from(Credential)
            .outerjoin(
                CredentialGroupShare,
                CredentialGroupShare.credential_id == Credential.id,
            )
            .outerjoin(Group, Group.id == CredentialGroupShare.group_id)
            .where(_owner_filter(Credential, owner_id))
            .order_by(Credential.created_at.desc())
        )
        if req.provider_endpoint_id is not None:
            stmt = stmt.where(
                Credential.provider_endpoint_id == req.provider_endpoint_id
            )
        result = await session.execute(stmt)

        # Aggregate: one entry per credential, group ids/names collected.
        cred_map: dict[str, Credential] = {}
        group_ids_map: dict[str, list[str]] = {}
        group_names_map: dict[str, list[str]] = {}
        for cred, gid, gname in result.all():
            if cred.id not in cred_map:
                cred_map[cred.id] = cred
                group_ids_map[cred.id] = []
                group_names_map[cred.id] = []
            if gid is not None:
                group_ids_map[cred.id].append(gid)
                group_names_map[cred.id].append(gname)

        return [
            CredentialResponse.from_orm_model(
                cred_map[cid],
                shared_group_ids=group_ids_map[cid],
                shared_group_names=group_names_map[cid],
            )
            for cid in cred_map
        ]

    return await run_in_read_session(_op)


@register_command("get_credential", readonly=True)
async def cmd_get_credential(params: dict) -> dict | None:
    req = CredentialIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        result = await session.execute(
            select(Credential).where(
                and_(
                    Credential.id == req.id,
                    _owner_filter(Credential, owner_id),
                )
            )
        )
        credential = result.scalar_one_or_none()
        return CredentialResponse.from_orm_model(credential) if credential else None

    return await run_in_read_session(_op)


@register_command("update_credential")
async def cmd_update_credential(params: dict) -> dict | None:
    """Update label/enabled only — secret rotation is NOT accepted here.

    Use ``rotate_credential_secret`` for secret changes.
    """
    req = CredentialUpdateRequest.model_validate(params)
    updates = req.model_dump(exclude={"id"}, exclude_none=True)
    owner_id = _caller_uid(params)

    async def _op(session):
        result = await session.execute(
            select(Credential).where(
                and_(
                    Credential.id == req.id,
                    _owner_filter(Credential, owner_id),
                )
            )
        )
        credential = result.scalar_one_or_none()
        if credential is None:
            return None
        for key, value in updates.items():
            if hasattr(credential, key):
                setattr(credential, key, value)
        if hasattr(credential, "updated_at"):
            credential.updated_at = _utcnow()
        await session.flush()
        await session.refresh(credential)
        return CredentialResponse.from_orm_model(credential)

    return await run_in_session(_op)


@register_command("rotate_credential_secret")
async def cmd_rotate_credential_secret(params: dict) -> dict | None:
    """Rotate the raw secret for a credential.

    Updates the linked ``CredentialSecret``, recomputes the credential's
    fingerprint, and resets ``runtime_status`` to ``"unknown"``. The raw
    secret is never returned in the response.
    """
    req = RotateCredentialSecretRequest.model_validate(params)

    async def _op(session):
        svc = CredentialService(session)
        credential = await svc.rotate_secret(req.id, req.new_secret)
        return CredentialResponse.from_orm_model(credential) if credential else None

    return await run_in_session(_op)


@register_command("delete_credential")
async def cmd_delete_credential(params: dict) -> dict:
    req = CredentialIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        result = await session.execute(
            select(Credential).where(
                and_(
                    Credential.id == req.id,
                    _owner_filter(Credential, owner_id),
                )
            )
        )
        credential = result.scalar_one_or_none()
        if credential is None:
            return False
        await session.delete(credential)
        await session.flush()
        return True

    deleted = await run_in_session(_op)
    return {"success": deleted}


# ═══════════════════════════════════════════════════════════════════════════
# UpstreamModel
# ═══════════════════════════════════════════════════════════════════════════


@register_command("create_upstream_model")
async def cmd_create_upstream_model(params: dict) -> dict:
    """Create (or idempotently update) an upstream model row.

    Delegates to ``UpstreamModelService.upsert_model`` — calling this
    command twice with the same ``(providerEndpointId, upstreamModelId)``
    updates the existing row rather than creating a duplicate.
    """
    req = UpstreamModelCreateRequest.model_validate(params)

    async def _op(session):
        svc = UpstreamModelService(session)
        model = await svc.upsert_model(
            req.provider_endpoint_id,
            req.upstream_model_id,
            display_name=req.display_name,
            enabled=req.enabled,
            discovery_source=req.discovery_source,
            capabilities=req.capabilities,
        )
        return UpstreamModelResponse.from_orm_model(model)

    return await run_in_session(_op)


@register_command("list_upstream_models", readonly=True)
async def cmd_list_upstream_models(params: dict) -> list[dict]:
    req = ListUpstreamModelsRequest.model_validate(params)

    async def _op(session):
        svc = UpstreamModelService(session)
        models = await svc.list_models(req.provider_endpoint_id)
        return [UpstreamModelResponse.from_orm_model(m) for m in models]

    return await run_in_read_session(_op)


@register_command("get_upstream_model", readonly=True)
async def cmd_get_upstream_model(params: dict) -> dict | None:
    req = UpstreamModelIdRequest.model_validate(params)

    async def _op(session):
        svc = UpstreamModelService(session)
        model = await svc.get_by_pk(req.id)
        return UpstreamModelResponse.from_orm_model(model) if model else None

    return await run_in_read_session(_op)


@register_command("update_upstream_model")
async def cmd_update_upstream_model(params: dict) -> dict | None:
    req = UpstreamModelUpdateRequest.model_validate(params)
    updates = req.model_dump(exclude={"id"}, exclude_none=True)

    async def _op(session):
        svc = UpstreamModelService(session)
        model = await svc.update_by_pk(req.id, **updates)
        return UpstreamModelResponse.from_orm_model(model) if model else None

    return await run_in_session(_op)


@register_command("delete_upstream_model")
async def cmd_delete_upstream_model(params: dict) -> dict:
    req = UpstreamModelIdRequest.model_validate(params)

    async def _op(session):
        svc = UpstreamModelService(session)
        return await svc.delete_by_pk(req.id)

    deleted = await run_in_session(_op)
    return {"success": deleted}


# ═══════════════════════════════════════════════════════════════════════════
# CredentialModelAccess
# ═══════════════════════════════════════════════════════════════════════════


@register_command("upsert_credential_model_access")
async def cmd_upsert_credential_model_access(params: dict) -> dict:
    req = CredentialModelAccessUpsertRequest.model_validate(params)

    async def _op(session):
        svc = CredentialModelAccessService(session)
        access = await svc.upsert_access(
            req.credential_id,
            req.upstream_model_id,
            status=req.status,
            last_error=req.last_error,
        )
        return CredentialModelAccessResponse.from_orm_model(access)

    return await run_in_session(_op)


@register_command("list_credential_model_access", readonly=True)
async def cmd_list_credential_model_access(params: dict) -> list[dict]:
    req = ListCredentialModelAccessRequest.model_validate(params)

    async def _op(session):
        svc = CredentialModelAccessService(session)
        rows = await svc.list_access(req.credential_id, req.upstream_model_id)
        return [CredentialModelAccessResponse.from_orm_model(r) for r in rows]

    return await run_in_read_session(_op)


@register_command("delete_credential_model_access")
async def cmd_delete_credential_model_access(params: dict) -> dict:
    req = CredentialModelAccessIdRequest.model_validate(params)

    async def _op(session):
        svc = CredentialModelAccessService(session)
        return await svc.delete_by_pk(req.id)

    deleted = await run_in_session(_op)
    return {"success": deleted}


# ═══════════════════════════════════════════════════════════════════════════
# PublicModel
# ═══════════════════════════════════════════════════════════════════════════


@register_command("create_public_model")
async def cmd_create_public_model(params: dict) -> dict:
    req = PublicModelCreateRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        svc = PublicModelService(session)
        model = await svc.create_public_model(
            req.id,
            display_name=req.display_name,
            enabled=req.enabled,
            contract=req.contract,
            owner_id=owner_id,
        )
        return PublicModelResponse.from_orm_model(model)

    return await run_in_session(_op)


@register_command("list_public_models", readonly=True)
async def cmd_list_public_models(params: dict) -> list[dict]:
    owner_id = _caller_uid(params)

    async def _op(session):
        svc = PublicModelService(session)
        models = await svc.list_public_models(owner_id=owner_id)
        return [PublicModelResponse.from_orm_model(m) for m in models]

    return await run_in_read_session(_op)


@register_command("get_public_model", readonly=True)
async def cmd_get_public_model(params: dict) -> dict | None:
    req = PublicModelIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        result = await session.execute(
            select(PublicModel).where(
                and_(
                    PublicModel.id == req.id,
                    _owner_filter(PublicModel, owner_id),
                )
            )
        )
        model = result.scalar_one_or_none()
        return PublicModelResponse.from_orm_model(model) if model else None

    return await run_in_read_session(_op)


@register_command("update_public_model")
async def cmd_update_public_model(params: dict) -> dict | None:
    req = PublicModelUpdateRequest.model_validate(params)
    updates = req.model_dump(exclude={"id"}, exclude_none=True)
    owner_id = _caller_uid(params)

    async def _op(session):
        result = await session.execute(
            select(PublicModel).where(
                and_(
                    PublicModel.id == req.id,
                    _owner_filter(PublicModel, owner_id),
                )
            )
        )
        model = result.scalar_one_or_none()
        if model is None:
            return None
        for key, value in updates.items():
            if hasattr(model, key):
                setattr(model, key, value)
        if hasattr(model, "updated_at"):
            model.updated_at = _utcnow()
        await session.flush()
        await session.refresh(model)
        return PublicModelResponse.from_orm_model(model)

    return await run_in_session(_op)


@register_command("delete_public_model")
async def cmd_delete_public_model(params: dict) -> dict:
    req = PublicModelIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    async def _op(session):
        result = await session.execute(
            select(PublicModel).where(
                and_(
                    PublicModel.id == req.id,
                    _owner_filter(PublicModel, owner_id),
                )
            )
        )
        model = result.scalar_one_or_none()
        if model is None:
            return False
        await session.delete(model)
        await session.flush()
        return True

    deleted = await run_in_session(_op)
    return {"success": deleted}


# ═══════════════════════════════════════════════════════════════════════════
# RouteTarget
# ═══════════════════════════════════════════════════════════════════════════


@register_command("create_route_target")
async def cmd_create_route_target(params: dict) -> dict:
    req = RouteTargetCreateRequest.model_validate(params)

    async def _op(session):
        svc = RouteTargetService(session)
        target = await svc.create_target(
            req.public_model_id,
            req.upstream_model_id,
            enabled=req.enabled,
            priority=req.priority,
            weight=req.weight,
            cost_modifier=req.cost_modifier,
        )
        return RouteTargetResponse.from_orm_model(target)

    return await run_in_session(_op)


@register_command("list_route_targets_for_public_model", readonly=True)
async def cmd_list_route_targets_for_public_model(params: dict) -> list[dict]:
    req = ListRouteTargetsForPublicModelRequest.model_validate(params)

    async def _op(session):
        svc = RouteTargetService(session)
        targets = await svc.list_targets_for_public_model(req.public_model_id)
        return [RouteTargetResponse.from_orm_model(t) for t in targets]

    return await run_in_read_session(_op)


@register_command("get_route_target", readonly=True)
async def cmd_get_route_target(params: dict) -> dict | None:
    req = RouteTargetIdRequest.model_validate(params)

    async def _op(session):
        svc = RouteTargetService(session)
        target = await svc.get_by_pk(req.id)
        return RouteTargetResponse.from_orm_model(target) if target else None

    return await run_in_read_session(_op)


@register_command("update_route_target")
async def cmd_update_route_target(params: dict) -> dict | None:
    req = RouteTargetUpdateRequest.model_validate(params)
    updates = req.model_dump(exclude={"id"}, exclude_none=True)

    async def _op(session):
        svc = RouteTargetService(session)
        target = await svc.update_by_pk(req.id, **updates)
        return RouteTargetResponse.from_orm_model(target) if target else None

    return await run_in_session(_op)


@register_command("delete_route_target")
async def cmd_delete_route_target(params: dict) -> dict:
    req = RouteTargetIdRequest.model_validate(params)

    async def _op(session):
        svc = RouteTargetService(session)
        return await svc.delete_by_pk(req.id)

    deleted = await run_in_session(_op)
    return {"success": deleted}


# ═══════════════════════════════════════════════════════════════════════════
# Discovery & Probe (on-demand)
# ═══════════════════════════════════════════════════════════════════════════


@register_command("discover_models_for_endpoint")
async def cmd_discover_models_for_endpoint(params: dict) -> dict:
    """On-demand model discovery for one endpoint.

    Delegates to ``DiscoveryWorker._discover_endpoint`` with a fresh session,
    then returns the total upstream model count for the endpoint.
    """
    req = ProviderEndpointIdRequest.model_validate(params)

    async def _op(session):
        ep_svc = ProviderEndpointService(session)
        endpoint = await ep_svc.get_by_pk(req.id)
        if endpoint is None:
            return {"models_count": 0}
        await cast("Any", DiscoveryWorker)._discover_endpoint(session, endpoint)
        model_svc = UpstreamModelService(session)
        models = await model_svc.list_models(req.id)
        return {"models_count": len(models)}

    return await run_in_session(_op)


@register_command("test_credential_connection")
async def cmd_test_credential_connection(params: dict) -> dict:
    """Probe one credential's health on-demand.

    Fetches the credential secret, resolves its endpoint, calls
    ``adapter.probe_credential(...)``, and returns the raw probe result.
    """
    req = CredentialIdRequest.model_validate(params)

    async def _op(session):
        cred_svc = CredentialService(session)
        credential = await cred_svc.get_by_pk(req.id)
        if credential is None:
            return {"success": False, "error": "Credential not found"}
        ep_svc = ProviderEndpointService(session)
        endpoint = await ep_svc.get_by_pk(credential.provider_endpoint_id)
        if endpoint is None:
            return {"success": False, "error": "Endpoint not found"}
        secret = await cred_svc.get_secret_for_invocation(req.id)
        if not secret:
            return {"success": False, "error": "No secret available"}
        adapter = get_adapter(endpoint.adapter_type)
        probe = await adapter.probe_credential(
            base_url=endpoint.base_url,
            secret=secret,
            default_headers=endpoint.default_headers,
        )
        return {
            "success": probe.success,
            "latency_ms": probe.latency_ms,
            "http_status": probe.http_status,
            "error": _sanitize_error(cast("BaseException", probe.error), secret="") if probe.error else None,
        }

    return await run_in_session(_op)


# ═══════════════════════════════════════════════════════════════════════════
# User proxy keys (per-user auth tokens for /v1/*)
# ═══════════════════════════════════════════════════════════════════════════


@register_command("proxy_keys_list")
async def cmd_proxy_keys_list(params: dict) -> dict:
    """List the caller's proxy keys + pool summary + gateway base URL.

    When the caller is authenticated (uid is not None) and has no enabled
    keys, a default key is auto-created (and committed).  When uid is
    None (auth disabled / desktop), returns ``keys: []`` with only the
    base URL.  Not marked ``readonly`` because of the auto-create side
    effect.
    """
    uid = _caller_uid(params)
    base_url = _gateway_base_url()

    if uid is None:
        return ProxyKeyListResponse(
            base_url=base_url,
            keys=[],
            pool={"personal": 0, "legacy": 0, "groups": []},
        ).model_dump(mode="json", by_alias=True)

    async def _op(session):
        svc = UserProxyKeyService(session)
        keys = await svc.list_proxy_keys(uid)

        # Auto-create a default key when the user has no enabled keys.
        if not any(k.enabled for k in keys):
            new_key, _raw = await svc.create_proxy_key(
                uid, label="default", is_default=True,
            )
            keys = [*keys, new_key]

        # Pool summary: personal credentials, legacy (instance-shared), groups.
        personal_result = await session.execute(
            select(func.count()).select_from(Credential).where(
                Credential.owner_id == uid
            )
        )
        personal = int(personal_result.scalar_one())

        legacy_result = await session.execute(
            select(func.count()).select_from(Credential).where(
                Credential.owner_id.is_(None)
            )
        )
        legacy = int(legacy_result.scalar_one())

        # Lazy import — avoids a top-level ``ai_gateway → groups`` edge.
        from stitch_backend.domains.groups.models import Group, GroupMember

        groups_stmt = (
            select(
                Group.id,
                Group.name,
                func.count(CredentialGroupShare.credential_id).label("keys"),
            )
            .select_from(Group)
            .join(GroupMember, GroupMember.group_id == Group.id)
            .outerjoin(
                CredentialGroupShare,
                CredentialGroupShare.group_id == Group.id,
            )
            .where(GroupMember.user_id == uid)
            .group_by(Group.id, Group.name)
            .order_by(Group.created_at.desc())
        )
        groups_result = await session.execute(groups_stmt)
        groups = [
            ProxyKeyPoolGroupEntry(
                id=row.id, name=row.name, keys=row.keys,
            )
            for row in groups_result.all()
        ]

        key_responses = [
            ProxyKeyResponse(
                id=k.id,
                label=k.label,
                masked_key=_mask_proxy_key_hash(k.token_hash),
                enabled=k.enabled,
                created_at=k.created_at,
                last_used_at=k.last_used_at,
                is_default=k.is_default,
            )
            for k in keys
        ]

        return ProxyKeyListResponse(
            base_url=base_url,
            keys=key_responses,
            pool={
                "personal": personal,
                "legacy": legacy,
                "groups": [g.model_dump(mode="json", by_alias=True) for g in groups],
            },
        )

    result = await run_in_session(_op)
    return result.model_dump(mode="json", by_alias=True)


@register_command("proxy_keys_create")
async def cmd_proxy_keys_create(params: dict) -> dict:
    """Create a new proxy key for the caller. Raw key is shown ONCE."""
    req = ProxyKeyCreateRequest.model_validate(params)
    uid = _caller_uid(params)

    async def _op(session):
        svc = UserProxyKeyService(session)
        record, raw = await svc.create_proxy_key(uid, label=req.label)
        return ProxyKeyCreatedResponse(key=raw, id=record.id)

    result = await run_in_session(_op)
    return result.model_dump(mode="json", by_alias=True)


@register_command("proxy_keys_revoke")
async def cmd_proxy_keys_revoke(params: dict) -> dict:
    """Revoke a proxy key (own only; default guarded)."""
    req = ProxyKeyRevokeRequest.model_validate(params)
    uid = _caller_uid(params)

    async def _op(session):
        svc = UserProxyKeyService(session)
        return await svc.revoke_proxy_key(req.id, uid)

    await run_in_session(_op)
    return {"success": True}


# ═══════════════════════════════════════════════════════════════════════════
# Legacy admin tools (gateway_claim_legacy / gateway_set_instance_shared)
# ═══════════════════════════════════════════════════════════════════════════


_GATEWAY_KIND_MODELS: dict[str, type] = {
    "credential": Credential,
    "endpoint": ProviderEndpoint,
    "public_model": PublicModel,
}


@register_command("gateway_claim_legacy", admin_only=True)
async def cmd_gateway_claim_legacy(params: dict) -> dict:
    """Claim a legacy (instance-shared) row for a user (admin only).

    Sets ``owner_id`` to ``assignToUserId`` (or the caller's uid when
    omitted).  Validates the row exists; raises ``StitchError`` otherwise.
    """
    req = GatewayClaimLegacyRequest.model_validate(params)
    uid = _caller_uid(params)
    target_uid = req.assign_to_user_id if req.assign_to_user_id is not None else uid
    model_cls = _GATEWAY_KIND_MODELS[req.kind]

    async def _op(session):
        result = await session.execute(
            select(model_cls).where(model_cls.id == req.id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise StitchError(f"{req.kind} not found: {req.id}")
        row.owner_id = target_uid
        if hasattr(row, "updated_at"):
            row.updated_at = _utcnow()
        await session.flush()
        return True

    await run_in_session(_op)
    return {"success": True}


@register_command("gateway_set_instance_shared", admin_only=True)
async def cmd_gateway_set_instance_shared(params: dict) -> dict:
    """Toggle instance-shared status for a gateway row (admin only).

    ``shared=True`` sets ``owner_id=NULL`` (instance-shared);
    ``shared=False`` sets ``owner_id`` to ``ownerId`` (or the caller's uid).
    """
    req = GatewaySetInstanceSharedRequest.model_validate(params)
    uid = _caller_uid(params)
    target_uid = None if req.shared else (
        req.owner_id if req.owner_id is not None else uid
    )
    model_cls = _GATEWAY_KIND_MODELS[req.kind]

    async def _op(session):
        result = await session.execute(
            select(model_cls).where(model_cls.id == req.id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise StitchError(f"{req.kind} not found: {req.id}")
        row.owner_id = target_uid
        if hasattr(row, "updated_at"):
            row.updated_at = _utcnow()
        await session.flush()
        return True

    await run_in_session(_op)
    return {"success": True}
