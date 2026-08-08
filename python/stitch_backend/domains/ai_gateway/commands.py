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

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import get_adapter
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error
from stitch_backend.domains.ai_gateway.discovery_worker import DiscoveryWorker
from stitch_backend.domains.ai_gateway.schemas import (
    CredentialCreateRequest,
    CredentialIdRequest,
    CredentialModelAccessIdRequest,
    CredentialModelAccessResponse,
    CredentialModelAccessUpsertRequest,
    CredentialResponse,
    CredentialUpdateRequest,
    ListCredentialModelAccessRequest,
    ListCredentialsRequest,
    ListRouteTargetsForPublicModelRequest,
    ListUpstreamModelsRequest,
    ProviderEndpointCreateRequest,
    ProviderEndpointIdRequest,
    ProviderEndpointResponse,
    ProviderEndpointUpdateRequest,
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
)

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# ProviderEndpoint
# ═══════════════════════════════════════════════════════════════════════════


@register_command("create_provider_endpoint")
async def cmd_create_provider_endpoint(params: dict) -> dict:
    req = ProviderEndpointCreateRequest.model_validate(params)

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
        )
        return ProviderEndpointResponse.from_orm_model(endpoint)

    return await run_in_session(_op)


@register_command("list_provider_endpoints", readonly=True)
async def cmd_list_provider_endpoints(params: dict) -> list[dict]:
    async def _op(session):
        svc = ProviderEndpointService(session)
        endpoints = await svc.list_endpoints()
        return [ProviderEndpointResponse.from_orm_model(e) for e in endpoints]

    return await run_in_read_session(_op)


@register_command("get_provider_endpoint", readonly=True)
async def cmd_get_provider_endpoint(params: dict) -> dict | None:
    req = ProviderEndpointIdRequest.model_validate(params)

    async def _op(session):
        svc = ProviderEndpointService(session)
        endpoint = await svc.get_by_pk(req.id)
        return ProviderEndpointResponse.from_orm_model(endpoint) if endpoint else None

    return await run_in_read_session(_op)


@register_command("update_provider_endpoint")
async def cmd_update_provider_endpoint(params: dict) -> dict | None:
    req = ProviderEndpointUpdateRequest.model_validate(params)
    updates = req.model_dump(exclude={"id"}, exclude_none=True)

    async def _op(session):
        svc = ProviderEndpointService(session)
        endpoint = await svc.update_by_pk(req.id, **updates)
        return ProviderEndpointResponse.from_orm_model(endpoint) if endpoint else None

    return await run_in_session(_op)


@register_command("delete_provider_endpoint")
async def cmd_delete_provider_endpoint(params: dict) -> dict:
    req = ProviderEndpointIdRequest.model_validate(params)

    async def _op(session):
        svc = ProviderEndpointService(session)
        return await svc.delete_by_pk(req.id)

    deleted = await run_in_session(_op)
    return {"success": deleted}


# ═══════════════════════════════════════════════════════════════════════════
# Credential
# ═══════════════════════════════════════════════════════════════════════════


@register_command("create_credential")
async def cmd_create_credential(params: dict) -> dict:
    req = CredentialCreateRequest.model_validate(params)

    async def _op(session):
        svc = CredentialService(session)
        credential = await svc.create_credential(
            provider_endpoint_id=req.provider_endpoint_id,
            label=req.label,
            auth_type=req.auth_type,
            secret=req.secret,
        )
        return CredentialResponse.from_orm_model(credential)

    return await run_in_session(_op)


@register_command("list_credentials", readonly=True)
async def cmd_list_credentials(params: dict) -> list[dict]:
    req = ListCredentialsRequest.model_validate(params)

    async def _op(session):
        svc = CredentialService(session)
        credentials = await svc.list_credentials(req.provider_endpoint_id)
        return [CredentialResponse.from_orm_model(c) for c in credentials]

    return await run_in_read_session(_op)


@register_command("get_credential", readonly=True)
async def cmd_get_credential(params: dict) -> dict | None:
    req = CredentialIdRequest.model_validate(params)

    async def _op(session):
        svc = CredentialService(session)
        credential = await svc.get_by_pk(req.id)
        return CredentialResponse.from_orm_model(credential) if credential else None

    return await run_in_read_session(_op)


@register_command("update_credential")
async def cmd_update_credential(params: dict) -> dict | None:
    """Update label/enabled only — secret rotation is NOT accepted here.

    Use ``rotate_credential_secret`` for secret changes.
    """
    req = CredentialUpdateRequest.model_validate(params)
    updates = req.model_dump(exclude={"id"}, exclude_none=True)

    async def _op(session):
        svc = CredentialService(session)
        credential = await svc.update_by_pk(req.id, **updates)
        return CredentialResponse.from_orm_model(credential) if credential else None

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

    async def _op(session):
        svc = CredentialService(session)
        return await svc.delete_by_pk(req.id)

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

    async def _op(session):
        svc = PublicModelService(session)
        model = await svc.create_public_model(
            req.id,
            display_name=req.display_name,
            enabled=req.enabled,
            contract=req.contract,
        )
        return PublicModelResponse.from_orm_model(model)

    return await run_in_session(_op)


@register_command("list_public_models", readonly=True)
async def cmd_list_public_models(params: dict) -> list[dict]:
    async def _op(session):
        svc = PublicModelService(session)
        models = await svc.list_public_models()
        return [PublicModelResponse.from_orm_model(m) for m in models]

    return await run_in_read_session(_op)


@register_command("get_public_model", readonly=True)
async def cmd_get_public_model(params: dict) -> dict | None:
    req = PublicModelIdRequest.model_validate(params)

    async def _op(session):
        svc = PublicModelService(session)
        model = await svc.get_by_pk(req.id)
        return PublicModelResponse.from_orm_model(model) if model else None

    return await run_in_read_session(_op)


@register_command("update_public_model")
async def cmd_update_public_model(params: dict) -> dict | None:
    req = PublicModelUpdateRequest.model_validate(params)
    updates = req.model_dump(exclude={"id"}, exclude_none=True)

    async def _op(session):
        svc = PublicModelService(session)
        model = await svc.update_by_pk(req.id, **updates)
        return PublicModelResponse.from_orm_model(model) if model else None

    return await run_in_session(_op)


@register_command("delete_public_model")
async def cmd_delete_public_model(params: dict) -> dict:
    req = PublicModelIdRequest.model_validate(params)

    async def _op(session):
        svc = PublicModelService(session)
        return await svc.delete_by_pk(req.id)

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
