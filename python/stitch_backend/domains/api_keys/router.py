"""REST API router for API Keys management."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from stitch_backend.database import run_in_session
from stitch_backend.domains.api_keys.schemas import PROVIDER_SCHEMAS
from stitch_backend.domains.api_keys.service import ApiKeysService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/api-keys", tags=["api-keys"])


class ApiKeysPayload(BaseModel):
    keys: list[dict[str, Any]]


@router.get("/{provider}")
async def get_keys(provider: str):
    """Load API keys for a provider."""
    if provider not in PROVIDER_SCHEMAS:
        raise HTTPException(404, f"Unknown provider: {provider}")

    async def _op(session):
        svc = ApiKeysService(session)
        return await svc.get_keys(provider)

    return await run_in_session(_op)


@router.put("/{provider}")
async def set_keys(provider: str, payload: ApiKeysPayload):
    """Replace all API keys for a provider."""
    if provider not in PROVIDER_SCHEMAS:
        raise HTTPException(404, f"Unknown provider: {provider}")

    async def _op(session):
        svc = ApiKeysService(session)
        await svc.set_keys(provider, payload.keys)
        return {"success": True}

    return await run_in_session(_op)


@router.get("")
async def list_providers():
    """List all known API key providers."""
    return {"providers": list(PROVIDER_SCHEMAS.keys())}
