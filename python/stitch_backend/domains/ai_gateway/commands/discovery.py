"""On-demand discovery & credential probe commands."""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, cast

from sqlalchemy import and_, select

from stitch_backend.core.command_decorator import command
from stitch_backend.domains.ai_gateway.adapters.base import (
    ClassifiedError,
    ProbeResult,
    get_adapter,
    get_adapter_capabilities,
)
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error
from stitch_backend.domains.ai_gateway.commands._common import (
    _caller_uid,
    _owner_filter,
)
from stitch_backend.domains.ai_gateway.credential_state import transition_credential
from stitch_backend.domains.ai_gateway.discovery_worker import DiscoveryWorker
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    ProviderEndpoint,
    UpstreamModel,
)
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

    from stitch_backend.domains.ai_gateway.adapters.base import ProviderAdapter

_CHAT_FALLBACK_PROMPT = "ping"
_CHAT_FALLBACK_TIMEOUT_SECONDS = 10.0


def _model_list_unusable(status: int | None) -> bool:
    return status is not None and (status in {404, 405} or status >= 500)


async def _first_enabled_model(db: AsyncSession, endpoint_id: str) -> str | None:
    result = await db.execute(
        select(UpstreamModel.upstream_model_id)
        .where(
            UpstreamModel.provider_endpoint_id == endpoint_id,
            UpstreamModel.enabled.is_(True),
        )
        .order_by(UpstreamModel.created_at)
        .limit(1)
    )
    return result.scalars().first()


async def _chat_fallback_probe(
    adapter: ProviderAdapter, *, endpoint: ProviderEndpoint, secret: str, model: str,
) -> ProbeResult | None:
    start = time.monotonic()
    try:
        await asyncio.wait_for(
            adapter.invoke(
                base_url=endpoint.base_url,
                secret=secret,
                model=model,
                messages=[{"role": "user", "content": _CHAT_FALLBACK_PROMPT}],
                stream=False,
                max_tokens=1,
            ),
            timeout=_CHAT_FALLBACK_TIMEOUT_SECONDS,
        )
    except Exception:  # noqa: BLE001
        return None
    return ProbeResult(
        success=True, latency_ms=(time.monotonic() - start) * 1000, http_status=200,
    )


@command("discover_models_for_endpoint")
async def cmd_discover_models_for_endpoint(db: AsyncSession, params: dict) -> dict:
    """On-demand model discovery for one endpoint.

    Delegates to ``DiscoveryWorker._discover_endpoint`` on the request session
    (it owns the single write connection), then returns the total upstream
    model count for the endpoint.
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
    outcome = await DiscoveryWorker._discover_endpoint(db, endpoint)
    model_svc = UpstreamModelService(db)
    models = await model_svc.list_models(req.id)
    return {
        "models_count": len(models),
        "credentials_checked": outcome["checked"],
        "credentials_failed": outcome["failed"],
    }


@command("test_credential_connection")
async def cmd_test_credential_connection(db: AsyncSession, params: dict) -> dict:
    """Probe one credential's health on-demand.

    Fetches the credential secret, resolves its endpoint, calls
    ``adapter.probe_credential(...)``, persists the resulting
    ``runtime_status`` transition, and returns the raw probe result.
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
    secret = await cred_svc.resolve_invocation_secret(credential)
    if secret is None:
        return {"success": False, "error": "No secret available"}
    adapter = get_adapter(endpoint.adapter_type)
    probe = await adapter.probe_credential(
        base_url=endpoint.base_url,
        secret=secret,
        default_headers=endpoint.default_headers,
    )
    if (
        not probe.success
        and _model_list_unusable(probe.http_status)
        and get_adapter_capabilities(endpoint.adapter_type).supports_chat
    ):
        fallback_model = await _first_enabled_model(db, endpoint.id)
        if fallback_model:
            fallback = await _chat_fallback_probe(
                adapter, endpoint=endpoint, secret=secret, model=fallback_model,
            )
            if fallback is not None:
                probe = fallback

    classified: ClassifiedError | None = None
    if not probe.success:
        if probe.http_status is not None:
            classified = adapter.classify_error(
                RuntimeError(probe.error or f"HTTP {probe.http_status}"),
                http_status=probe.http_status,
                response_body=probe.error_body,
            )
        else:
            classified = ClassifiedError(
                category="transport_error", is_endpoint_wide=True,
            )
    await transition_credential(
        db, req.id, error=classified, http_status=probe.http_status,
    )

    return {
        "success": probe.success,
        "latency_ms": probe.latency_ms,
        "http_status": probe.http_status,
        "error": _sanitize_error(cast("BaseException", probe.error), secret="") if probe.error else None,
    }
