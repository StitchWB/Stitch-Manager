"""API Keys command handlers — thin adapters around ApiKeysService.

Each command maps to the corresponding Rust Tauri command.
"""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_get_cmd(provider: str):
    """Create a ``get_*_api_keys`` handler for a provider."""

    async def handler(params: dict) -> list:
        async def _op(session):
            from stitch_backend.domains.api_keys.service import ApiKeysService

            svc = ApiKeysService(session)
            return await svc.get_keys(provider)

        return await run_in_session(_op)

    return handler


def _make_set_cmd(provider: str):
    """Create a ``set_*_api_keys`` handler for a provider."""

    async def handler(params: dict) -> dict:
        keys = params.get("keys", [])
        if not isinstance(keys, list):
            keys = []

        async def _op(session):
            from stitch_backend.domains.api_keys.service import ApiKeysService

            svc = ApiKeysService(session)
            await svc.set_keys(provider, keys)
            return {"success": True}

        return await run_in_session(_op)

    return handler


# ── Register all provider API-key commands ───────────────────────────────────

_PROVIDERS = ["gemini", "openai", "anthropic", "antigravity", "fireworks", "zai", "dashscope"]

for _p in _PROVIDERS:
    register_command(f"get_{_p}_api_keys")(_make_get_cmd(_p))
    register_command(f"set_{_p}_api_keys")(_make_set_cmd(_p))


# ── Custom provider commands ─────────────────────────────────────────────────

@register_command("get_custom_providers")
async def get_custom_providers_cmd(params: dict) -> list:
    async def _op(session):
        from stitch_backend.domains.api_keys.custom_providers import get_custom_providers
        providers = await get_custom_providers(session)
        return [p.to_dict() for p in providers]
    return await run_in_session(_op)


@register_command("add_custom_provider")
async def add_custom_provider_cmd(params: dict) -> dict:
    name = params.get("name", "")
    base_url = params.get("baseUrl", "")
    litellm_model = params.get("litellmModel", "openai/*")
    if not name or not base_url:
        return {"success": False, "error": "name and baseUrl are required"}
    async def _op(session):
        from stitch_backend.domains.api_keys.custom_providers import add_custom_provider
        provider = await add_custom_provider(session, name, base_url, litellm_model)
        return {"success": True, "provider": provider.to_dict()}
    return await run_in_session(_op)


@register_command("remove_custom_provider")
async def remove_custom_provider_cmd(params: dict) -> dict:
    provider_id = params.get("id", "")
    if not provider_id:
        return {"success": False, "error": "id is required"}
    async def _op(session):
        from stitch_backend.domains.api_keys.custom_providers import remove_custom_provider
        removed = await remove_custom_provider(session, provider_id)
        return {"success": removed}
    return await run_in_session(_op)


@register_command("get_custom_provider_keys")
async def get_custom_provider_keys_cmd(params: dict) -> list:
    provider_id = params.get("providerId", "")
    if not provider_id:
        return []
    db_key = f"custom_{provider_id}_api_keys"
    async def _op(session):
        from stitch_backend.domains.api_keys.service import ApiKeysService
        svc = ApiKeysService(session)
        return await svc.get_keys_by_db_key(db_key)
    return await run_in_session(_op)


@register_command("set_custom_provider_keys")
async def set_custom_provider_keys_cmd(params: dict) -> dict:
    provider_id = params.get("providerId", "")
    keys = params.get("keys", [])
    if not provider_id or not isinstance(keys, list):
        return {"success": False, "error": "providerId and keys are required"}
    db_key = f"custom_{provider_id}_api_keys"
    async def _op(session):
        from stitch_backend.domains.api_keys.service import ApiKeysService
        svc = ApiKeysService(session)
        await svc.set_keys_by_db_key(db_key, keys)
        return {"success": True}
    return await run_in_session(_op)
