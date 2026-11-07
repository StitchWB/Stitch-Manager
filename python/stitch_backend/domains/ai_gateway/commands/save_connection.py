"""Unified connection save + adapter capabilities commands."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from stitch_backend.core.command_decorator import command
from stitch_backend.domains.ai_gateway.adapters.base import list_adapter_capabilities
from stitch_backend.domains.ai_gateway.commands._common import _caller_uid
from stitch_backend.domains.ai_gateway.connection_service import save_connection
from stitch_backend.domains.ai_gateway.schemas import (
    AdapterCapabilitiesResponse,
    SaveConnectionRequest,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@command("save_connection")
async def cmd_save_connection(db: AsyncSession, params: dict) -> Any:
    """Save one connection: endpoint (match-or-create) + all keys, atomically.

    No probes, no network beyond the base_url SSRF validation; optional
    connectivity checks are separate commands the frontend may run after.
    """
    req = SaveConnectionRequest.model_validate(params)
    return await save_connection(db, req, _caller_uid(params))


@command("get_adapter_capabilities", readonly=True)
async def cmd_get_adapter_capabilities(db: AsyncSession, params: dict) -> Any:
    return [
        AdapterCapabilitiesResponse(
            adapter_type=caps.adapter_type,
            supports_none_auth=caps.supports_none_auth,
            supports_chat=caps.supports_chat,
            supports_responses=caps.supports_responses,
            supports_model_discovery=caps.supports_model_discovery,
            limitations=list(caps.limitations),
        )
        for caps in list_adapter_capabilities()
    ]
