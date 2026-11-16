from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from stitch_backend.core.command_decorator import command
from stitch_backend.domains.ai_gateway.adapters.base import get_adapter
from stitch_backend.domains.ai_gateway.adapters.configurable import QuotaProbeResult
from stitch_backend.domains.ai_gateway.commands._common import (
    _caller_uid,
    _owner_filter,
)
from stitch_backend.domains.ai_gateway.credential_state import transition_credential
from stitch_backend.domains.ai_gateway.models import Credential, ProviderEndpoint
from stitch_backend.domains.ai_gateway.service import (
    CredentialService,
    ProviderEndpointService,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class RefreshEndpointQuotaRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    endpoint_id: str | None = Field(None, alias="endpointId")
    credential_id: str | None = Field(None, alias="credentialId")

    @model_validator(mode="after")
    def _require_target(self) -> RefreshEndpointQuotaRequest:
        if not self.endpoint_id and not self.credential_id:
            raise ValueError("one of endpointId or credentialId is required")
        return self


@command("refresh_endpoint_quota")
async def cmd_refresh_endpoint_quota(db: AsyncSession, params: dict) -> dict[str, int]:
    req = RefreshEndpointQuotaRequest.model_validate(params)
    owner_id = _caller_uid(params)

    query = (
        select(Credential)
        .where(_owner_filter(Credential, owner_id))
        .where(Credential.enabled.is_(True))
    )

    if req.credential_id:
        query = query.where(Credential.id == req.credential_id)
    elif req.endpoint_id:
        query = query.where(Credential.provider_endpoint_id == req.endpoint_id)

    res = await db.execute(query)
    credentials = list(res.scalars().all())

    if not credentials:
        return {"checked": 0, "suspended": 0}

    ep_svc = ProviderEndpointService(db)
    cred_svc = CredentialService(db)

    endpoint_ids = {c.provider_endpoint_id for c in credentials}
    endpoints_map: dict[str, ProviderEndpoint | None] = {}
    for ep_id in endpoint_ids:
        endpoints_map[ep_id] = await ep_svc.get_by_pk(ep_id)

    tasks_data: list[tuple[Credential, ProviderEndpoint, str]] = []
    for cred in credentials:
        ep = endpoints_map.get(cred.provider_endpoint_id)
        if ep is None:
            continue
        secret = await cred_svc.resolve_invocation_secret(cred)
        if not secret:
            continue
        tasks_data.append((cred, ep, secret))

    if not tasks_data:
        return {"checked": 0, "suspended": 0}

    sem = asyncio.Semaphore(4)

    async def _probe_one(
        cred: Credential, ep: ProviderEndpoint, secret: str
    ) -> tuple[Credential, Any]:
        async with sem:
            adapter = get_adapter(ep.adapter_type)
            if not hasattr(adapter, "probe_quota"):
                return cred, None
            try:
                res = await adapter.probe_quota(
                    base_url=ep.base_url,
                    secret=secret,
                    default_headers=ep.default_headers,
                )
                return cred, res
            except Exception:
                return cred, None

    probe_coros = [_probe_one(c, ep, s) for c, ep, s in tasks_data]
    try:
        results = await asyncio.wait_for(
            asyncio.gather(*probe_coros, return_exceptions=True),
            timeout=20.0,
        )
    except TimeoutError:
        results = []

    checked = 0
    suspended = 0
    now = datetime.now(UTC)

    for item in results:
        if not isinstance(item, tuple) or len(item) != 2:
            continue
        cred, probe_res = item
        if probe_res is None or not isinstance(probe_res, QuotaProbeResult):
            continue

        checked += 1
        cred.remaining_checked_at = now
        if probe_res.remaining_usd is not None:
            cred.remaining_usd = probe_res.remaining_usd

        if probe_res.suspended:
            suspended += 1
            if probe_res.classified is not None:
                await transition_credential(
                    db,
                    cred.id,
                    error=probe_res.classified,
                    http_status=401,
                    source="probe",
                )

    await db.flush()
    return {"checked": checked, "suspended": suspended}
