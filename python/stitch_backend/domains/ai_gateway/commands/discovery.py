"""On-demand discovery & credential probe commands."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import and_, select

from stitch_backend.core.command_decorator import command
from stitch_backend.domains.ai_gateway.adapters.base import get_adapter
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error
from stitch_backend.domains.ai_gateway.commands._common import (
    _caller_uid,
    _owner_filter,
)
from stitch_backend.domains.ai_gateway.discovery_worker import DiscoveryWorker
from stitch_backend.domains.ai_gateway.models import Credential, ProviderEndpoint
from stitch_backend.domains.ai_gateway.schemas import (
    CredentialIdRequest,
    ProviderEndpointIdRequest,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialService,
    ProviderEndpointService,
    UpstreamModelService,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@command("discover_models_for_endpoint")
async def cmd_discover_models_for_endpoint(db: AsyncSession, params: dict) -> dict:
    """On-demand model discovery for one endpoint.

    Delegates to ``DiscoveryWorker._discover_endpoint`` with a fresh session,
    then returns the total upstream model count for the endpoint.
    """
    req = ProviderEndpointIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    result = await db.execute(
        select(ProviderEndpoint).where(
            and_(
                ProviderEndpoint.id == req.id,
                _owner_filter(ProviderEndpoint, owner_id),
            )
        )
    )
    endpoint = result.scalar_one_or_none()
    if endpoint is None:
        return {"models_count": 0}
    await cast("Any", DiscoveryWorker)._discover_endpoint(db, endpoint)
    model_svc = UpstreamModelService(db)
    models = await model_svc.list_models(req.id)
    return {"models_count": len(models)}


@command("test_credential_connection")
async def cmd_test_credential_connection(db: AsyncSession, params: dict) -> dict:
    """Probe one credential's health on-demand.

    Fetches the credential secret, resolves its endpoint, calls
    ``adapter.probe_credential(...)``, and returns the raw probe result.
    """
    req = CredentialIdRequest.model_validate(params)
    owner_id = _caller_uid(params)

    result = await db.execute(
        select(Credential).where(
            and_(
                Credential.id == req.id,
                _owner_filter(Credential, owner_id),
            )
        )
    )
    credential = result.scalar_one_or_none()
    if credential is None:
        return {"success": False, "error": "Credential not found"}
    ep_svc = ProviderEndpointService(db)
    endpoint = await ep_svc.get_by_pk(credential.provider_endpoint_id)
    if endpoint is None:
        return {"success": False, "error": "Endpoint not found"}
    cred_svc = CredentialService(db)
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
