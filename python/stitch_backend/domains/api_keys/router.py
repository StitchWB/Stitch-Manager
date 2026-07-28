"""REST API router for API Keys management."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from stitch_backend.database import run_in_session
from stitch_backend.domains.api_keys.service import ApiKeysService
from stitch_backend.domains.api_keys.schemas import PROVIDER_SCHEMAS
from stitch_backend.domains.ai_proxy.model_availability import get_model_tracker

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

    result = await run_in_session(_op)
    
    # Register keys in model availability tracker
    model_tracker = get_model_tracker()
    for key_data in payload.keys:
        api_key = key_data.get("apiKey") or key_data.get("api_key")
        base_url = key_data.get("baseUrl") or key_data.get("base_url")
        
        if api_key and base_url:
            # Use provider + first 8 chars of key as key_id
            key_id = f"{provider}_{api_key[:8]}"
            await model_tracker.register_key(key_id, api_key, base_url)
            logger.info(
                "Registered key %s... for provider %s in model tracker",
                api_key[:8], provider
            )
    
    return result


@router.get("")
async def list_providers():
    """List all known API key providers."""
    return {"providers": list(PROVIDER_SCHEMAS.keys())}
