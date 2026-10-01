"""API Keys command handlers — thin adapters around ApiKeysService.

Each command maps to the corresponding Rust backend command.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.core.command_decorator import command
from stitch_backend.domains.api_keys.schemas import GetApiKeysRequest, SetApiKeysRequest

# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_get_cmd(provider: str):
    """Create a ``get_*_api_keys`` handler for a provider."""

    async def handler(db: AsyncSession, params: dict) -> list:
        GetApiKeysRequest.model_validate(params)

        from stitch_backend.domains.api_keys.service import ApiKeysService

        svc = ApiKeysService(db)
        return await svc.get_keys(provider)

    handler = cast("Any", command(f"get_{provider}_api_keys")(handler))
    cast("Any", handler)._request_model = GetApiKeysRequest  # ponytail: for AST-immune dynamic generators
    return handler


def _make_set_cmd(provider: str):
    """Create a ``set_*_api_keys`` handler for a provider."""

    async def handler(db: AsyncSession, params: dict) -> dict:
        req = SetApiKeysRequest.model_validate(params)

        from stitch_backend.domains.api_keys.service import ApiKeysService

        svc = ApiKeysService(db)
        await svc.set_keys(provider, req.keys)
        return {"success": True}

    handler = cast("Any", command(f"set_{provider}_api_keys")(handler))
    cast("Any", handler)._request_model = SetApiKeysRequest  # ponytail: for AST-immune dynamic generators
    return handler


# ── Register all provider API-key commands ───────────────────────────────────

_PROVIDERS = ["gemini", "openai", "anthropic", "antigravity", "fireworks", "zai", "dashscope"]

for _p in _PROVIDERS:
    _make_get_cmd(_p)
    _make_set_cmd(_p)


# ── Custom provider commands ─────────────────────────────────────────────────

@command("get_custom_providers")
async def get_custom_providers_cmd(db: AsyncSession, params: dict) -> list:
    from stitch_backend.domains.api_keys.custom_providers import get_custom_providers
    providers = await get_custom_providers(db)
    return [p.to_dict() for p in providers]


@command("add_custom_provider")
async def add_custom_provider_cmd(db: AsyncSession, params: dict) -> dict:
    name = params.get("name", "")
    base_url = params.get("baseUrl", "")
    litellm_model = params.get("litellmModel", "openai/*")
    if not name or not base_url:
        return {"success": False, "error": "name and baseUrl are required"}
    from stitch_backend.domains.api_keys.custom_providers import add_custom_provider
    provider = await add_custom_provider(db, name, base_url, litellm_model)
    return {"success": True, "provider": provider.to_dict()}


@command("remove_custom_provider")
async def remove_custom_provider_cmd(db: AsyncSession, params: dict) -> dict:
    provider_id = params.get("id", "")
    if not provider_id:
        return {"success": False, "error": "id is required"}
    from stitch_backend.domains.api_keys.custom_providers import remove_custom_provider
    removed = await remove_custom_provider(db, provider_id)
    return {"success": removed}


@command("get_custom_provider_keys")
async def get_custom_provider_keys_cmd(db: AsyncSession, params: dict) -> list:
    provider_id = params.get("providerId", "")
    if not provider_id:
        return []
    db_key = f"custom_{provider_id}_api_keys"
    from stitch_backend.domains.api_keys.service import ApiKeysService
    svc = ApiKeysService(db)
    return await svc.get_keys_by_db_key(db_key)


@command("set_custom_provider_keys")
async def set_custom_provider_keys_cmd(db: AsyncSession, params: dict) -> dict:
    provider_id = params.get("providerId", "")
    keys = params.get("keys", [])
    if not provider_id or not isinstance(keys, list):
        return {"success": False, "error": "providerId and keys are required"}
    db_key = f"custom_{provider_id}_api_keys"
    from stitch_backend.domains.api_keys.service import ApiKeysService
    svc = ApiKeysService(db)
    await svc.set_keys_by_db_key(db_key, keys)
    return {"success": True}
