"""Legacy admin tools (gateway_claim_legacy / gateway_set_instance_shared)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway.commands._common import _caller_uid
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    ProviderEndpoint,
    PublicModel,
    _utcnow,
)
from stitch_backend.domains.ai_gateway.schemas import (
    GatewayClaimLegacyRequest,
    GatewaySetInstanceSharedRequest,
)

_GATEWAY_KIND_MODELS: dict[str, type[Any]] = {
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
