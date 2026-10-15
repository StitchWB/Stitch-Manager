"""Key Health command handlers — 2 read-only API commands.

get_key_health — return all or provider-specific health records
get_key_models — return discovered models for a key
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from stitch_backend.core.command_decorator import command

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@command("get_key_health", readonly=True)
async def cmd_get_key_health(db: AsyncSession, params: dict) -> list[dict[str, Any]]:
    """Return all key health records, optionally filtered by provider.

    Params:
        providerId (str, optional): Filter by provider identifier.
    """
    from stitch_backend.domains.key_health.service import KeyHealthService

    provider_id = params.get("providerId") or params.get("provider_id")

    svc = KeyHealthService(db)
    if provider_id:
        records = await svc.get_provider_health(provider_id)
    else:
        records = await svc.get_all_health()
    return [KeyHealthService.to_dict(r) for r in records]


@command("get_key_models", readonly=True)
async def cmd_get_key_models(db: AsyncSession, params: dict) -> dict[str, Any]:
    """Return discovered models for a specific key hash.

    Params:
        keyHash (str): SHA256 hash of the key.

    Returns:
        {"models": [...], "providerId": "...", "status": "..."}
    """
    from stitch_backend.domains.key_health.service import KeyHealthService

    key_hash = params.get("keyHash") or params.get("key_hash")
    if not key_hash:
        return {"error": "keyHash is required"}

    svc = KeyHealthService(db)
    record = await svc.get_health(key_hash)
    if record is None:
        return {"error": "Key not found"}
    return {
        "models": record.models_available or [],
        "providerId": record.provider_id,
        "status": record.status,
        "lastTestedAt": record.last_tested_at.isoformat()
        if record.last_tested_at else None,
    }
