"""Model catalog commands — availability, selection, mappings, capabilities."""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any, cast

from stitch_backend.core.command_decorator import command
from stitch_backend.core.command_registry import register_command
from stitch_backend.core.http_gateway import ProxyUnavailableError
from stitch_backend.domains.ai_proxy.commands._common import _alias_owner_id
from stitch_backend.domains.ai_proxy.commands.discovery import (
    _FALLBACK_MODELS,
    _fetch_all_provider_models,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Simple in-memory cache for model discovery (300s TTL)
_models_cache: dict = {"data": None, "expires": 0}
_CACHE_TTL = 300  # seconds


@register_command("get_available_models", readonly=True)
async def cmd_get_available_models(params: dict) -> list:
    """Return models from actually connected providers via real API calls.

    Session discipline: the DB session is held ONLY for the short preload
    phase (accounts + API keys).  The network fetch runs OUTSIDE any DB
    session, bounded by a 15s ``asyncio.wait_for`` deadline so a hung proxy
    handshake cannot block the single SQLite write connection.
    """
    import asyncio
    import time

    from stitch_backend.database import run_in_session
    from stitch_backend.domains.ai_proxy.legacy_accounts_api import list_accounts
    from stitch_backend.domains.api_keys.service import ApiKeysService

    # Check cache
    now = time.time()
    if _models_cache["data"] is not None and _models_cache["expires"] > now:
        return cast("list[Any]", _models_cache["data"])

    # Phase 1: short DB session — preload accounts + API keys, then close.
    async def _preload(session):
        accounts = await list_accounts(session)
        enabled_providers = {
            (a.get("provider") or "").lower()
            for a in accounts if a.get("enabled")
        }
        svc = ApiKeysService(session)
        api_keys: dict[str, list[dict]] = {}
        for provider in ("openai", "anthropic", "gemini", "antigravity", "fireworks", "zai", "dashscope"):
            try:
                keys = await svc.get_keys(provider)
                if keys:
                    api_keys[provider] = keys
            except Exception as e:
                logger.warning("[Models] Error checking keys for %s: %s", provider, e)

        # Web-bridge providers (in-process adapters): ORM accounts + settings, same short session.
        from stitch_backend.domains.ai_proxy.service import get_web_gemini_settings
        from stitch_backend.domains.ai_proxy.web.gemini_adapter import (
            load_web_gemini_accounts,
        )

        web_gemini_settings = await get_web_gemini_settings(session)
        web_gemini_accounts = await load_web_gemini_accounts(session)
        if web_gemini_settings["enabled"] and (
            web_gemini_accounts or web_gemini_settings["anonymous_allowed"]
        ):
            enabled_providers.add("web-gemini")

        # web-deepseek: no anonymous mode — enabled only with live accounts.
        from stitch_backend.domains.ai_proxy.service import get_web_deepseek_settings
        from stitch_backend.domains.ai_proxy.web.deepseek_adapter import (
            load_web_deepseek_accounts,
        )

        web_deepseek_settings = await get_web_deepseek_settings(session)
        web_deepseek_accounts = await load_web_deepseek_accounts(session)
        if web_deepseek_settings["enabled"] and web_deepseek_accounts:
            enabled_providers.add("web-deepseek")

        # web-qwen: no anonymous mode — enabled only with live accounts.
        from stitch_backend.domains.ai_proxy.service import get_web_qwen_settings
        from stitch_backend.domains.ai_proxy.web.qwen_adapter import (
            load_web_qwen_accounts,
        )

        web_qwen_settings = await get_web_qwen_settings(session)
        web_qwen_accounts = await load_web_qwen_accounts(session)
        if web_qwen_settings["enabled"] and web_qwen_accounts:
            enabled_providers.add("web-qwen")
        return (
            accounts,
            enabled_providers,
            api_keys,
            web_gemini_accounts,
            web_gemini_settings,
            web_deepseek_accounts,
            web_deepseek_settings,
            web_qwen_accounts,
            web_qwen_settings,
        )

    try:
        (
            accounts,
            enabled_providers,
            api_keys,
            web_gemini_accounts,
            web_gemini_settings,
            web_deepseek_accounts,
            web_deepseek_settings,
            web_qwen_accounts,
            web_qwen_settings,
        ) = await run_in_session(_preload)
    except Exception as e:
        logger.error("[Models] Failed to preload provider data: %s", e)
        if _models_cache["data"] is not None:
            logger.warning("[Models] Serving stale cache after preload failure")
            return cast("list[Any]", _models_cache["data"])
        return []

    # Phase 2: network fetch OUTSIDE any DB session — bounded by 15s.
    result: list = []
    try:
        result = await asyncio.wait_for(
            _fetch_all_provider_models(
                accounts,
                api_keys,
                enabled_providers,
                web_gemini_accounts=web_gemini_accounts,
                web_gemini_settings=web_gemini_settings,
                web_deepseek_accounts=web_deepseek_accounts,
                web_deepseek_settings=web_deepseek_settings,
                web_qwen_accounts=web_qwen_accounts,
                web_qwen_settings=web_qwen_settings,
            ),
            timeout=15.0,
        )
    except TimeoutError:
        logger.warning("[Models] Fetch timed out after 15s — serving stale cache")
    except ProxyUnavailableError as e:
        logger.warning("[Models] Proxy unavailable: %s — serving stale cache", e)
    except Exception as e:
        logger.error("[Models] Fetch failed: %s — serving stale cache", e)

    # On any failure serve stale cache even if expired — [] only when there was never any data.
    if not result and _models_cache["data"] is not None:
        logger.warning("[Models] Serving stale cache (expired=%s)",
                       _models_cache["expires"] <= now)
        return cast("list[Any]", _models_cache["data"])

    # Fallback: if all API calls returned [], use known models for connected providers
    if not result:
        logger.warning("[Models] All API calls returned empty — using fallback for %s",
                       enabled_providers | set(api_keys.keys()))
        for provider in enabled_providers | set(api_keys.keys()):
            if provider in _FALLBACK_MODELS:
                for m in _FALLBACK_MODELS[provider]:
                    result.append({"id": m["id"], "provider": provider, "name": m["name"]})

    # Update cache
    _models_cache["data"] = result
    _models_cache["expires"] = now + _CACHE_TTL

    return result


@register_command("get_local_chat_token", readonly=True)
async def cmd_get_local_chat_token(params: dict) -> dict:
    """Return the per-install local chat token for the /v1/chat/completions
    endpoint. The frontend uses this as the request bearer."""
    from stitch_backend.domains.ai_proxy.chat_router import ensure_local_chat_token

    token = await ensure_local_chat_token()
    return {"token": token}


@command("get_enabled_models")
async def cmd_get_enabled_models(db: AsyncSession, params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import get_settings_kv

    raw = await get_settings_kv(db, "enabled_models")
    if raw:
        try:
            return cast("list[Any]", json.loads(raw))
        except json.JSONDecodeError:
            return []
    return []


@command("set_enabled_models")
async def cmd_set_enabled_models(db: AsyncSession, params: dict) -> None:
    from stitch_backend.domains.ai_proxy.service import set_settings_kv
    models = params.get("models", [])
    if isinstance(models, list):
        value = json.dumps(models)
    else:
        value = str(models)

    await set_settings_kv(db, "enabled_models", value)


@command("get_provider_model_mappings")
async def cmd_get_provider_model_mappings(db: AsyncSession, params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import get_settings_kv

    raw = await get_settings_kv(db, "provider_model_mappings")
    if raw:
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


@command("set_provider_model_mappings")
async def cmd_set_provider_model_mappings(db: AsyncSession, params: dict) -> None:
    from stitch_backend.domains.ai_proxy.service import set_settings_kv
    mappings = params.get("mappings", params)
    value = json.dumps(mappings) if isinstance(mappings, (dict, list)) else str(mappings)

    await set_settings_kv(db, "provider_model_mappings", value)


@command("get_provider_capabilities")
async def cmd_get_provider_capabilities(db: AsyncSession, params: dict) -> list:
    from stitch_backend.domains.ai_proxy.legacy_accounts_api import list_accounts
    providers = ("openai", "gemini", "anthropic", "antigravity", "fireworks", "zai")
    owner_id = _alias_owner_id(params)

    accounts = await list_accounts(db, owner_id=owner_id)
    result = []
    for provider in providers:
        total = [a for a in accounts if a["provider"].lower() == provider]
        enabled = [a for a in total if a["enabled"]]
        result.append({
            "provider": provider,
            "supportsApiKeys": provider in ("openai", "gemini", "antigravity", "anthropic", "fireworks", "zai"),
            "supportsOauth": provider != "zai",
            "totalAccounts": len(total),
            "enabledAccounts": len(enabled),
            "totalApiKeys": 0,
            "configured": len(enabled) > 0,
        })
    return result
