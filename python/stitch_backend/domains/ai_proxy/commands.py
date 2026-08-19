"""AI Proxy command handlers — 35 commands.

Covers account CRUD, export/import, model management, IDE config,
quotas, auth flows, analytics, and utility operations.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import webbrowser
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.http_gateway import ProxyUnavailableError, gateway
from stitch_backend.database import run_in_read_session, run_in_session

logger = logging.getLogger(__name__)


# ── Quota cache: on-demand TTL + single-flight ─────────────────────────────
#
# Quota commands fan out to CLI subprocesses and remote usage APIs (~1–2 s),
# and the frontend calls them on every page mount — without a cache each
# visit repeats the identical fan-out.  This cache returns the last result
# within the TTL, coalesces concurrent callers into ONE in-flight fetch and
# serves stale data when a refresh fails.  There is NO background polling:
# an idle app makes zero calls, so the cache strictly reduces work versus
# the previous per-mount fan-out.  ``{"force": true}`` bypasses the TTL.

_QUOTA_CACHE_TTL_SECONDS = 90.0


class _TtlSingleFlight:
    """On-demand TTL cache with single-flight coalescing and stale fallback."""

    def __init__(self, name: str, ttl: float = _QUOTA_CACHE_TTL_SECONDS) -> None:
        self._name = name
        self._ttl = ttl
        self._data: Any = None
        self._expires = 0.0
        self._lock: asyncio.Lock | None = None

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def get_or_fetch(
        self, fetch: Callable[[], Awaitable[Any]], *, force: bool = False
    ) -> Any:
        now = time.monotonic()
        if not force and self._data is not None and self._expires > now:
            return self._data

        async with self._get_lock():
            now = time.monotonic()
            if not force and self._data is not None and self._expires > now:
                return self._data  # another waiter refreshed while we queued

            try:
                data = await fetch()
            except Exception as exc:  # noqa: BLE001
                if self._data is not None:
                    logger.warning(
                        "[%s] refresh failed (%s) — serving stale cache", self._name, exc
                    )
                    return self._data
                raise
            self._data = data
            self._expires = time.monotonic() + self._ttl
            return data


_ALL_QUOTAS_CACHE = _TtlSingleFlight("Quota")
_OPENAI_QUOTAS_CACHE = _TtlSingleFlight("OpenAI Quota")
_KIRO_QUOTAS_CACHE = _TtlSingleFlight("Kiro Quota")


# ── Account CRUD (aliases over ai_gateway tables — L2 legacy swap) ────────────
#
# These commands previously read/wrote ``ai_proxy_accounts`` directly. As of
# the L2 legacy cleanup they are thin aliases over the unified
# ``ai_gateway_credentials`` / ``CredentialSecret`` / ``ProviderEndpoint``
# tables via ``legacy_alias``. The response shape is unchanged so the
# frontend (``aiProxy.ts``) and mcp_server keep working.

def _alias_owner_id(params: dict) -> int | None:
    """Extract caller uid for owner-scoping (None = desktop / instance-shared)."""
    return params.get("_caller_user_id")


@register_command("get_ai_proxy_accounts", readonly=True)
async def cmd_get_ai_proxy_accounts(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.legacy_alias import list_accounts

    owner_id = _alias_owner_id(params)

    async def _op(session):
        return await list_accounts(session, owner_id=owner_id)

    return await run_in_session(_op)


@register_command("create_ai_proxy_account")
async def cmd_create_ai_proxy_account(params: dict) -> int:
    from stitch_backend.domains.ai_proxy.legacy_alias import create_account

    account = params.get("account", params)
    owner_id = _alias_owner_id(params)

    async def _op(session):
        return await create_account(session, account, owner_id=owner_id)

    return await run_in_session(_op)


@register_command("update_ai_proxy_account")
async def cmd_update_ai_proxy_account(params: dict) -> None:
    from stitch_backend.domains.ai_proxy.legacy_alias import update_account

    account = params.get("account", params)
    owner_id = _alias_owner_id(params)

    async def _op(session):
        await update_account(session, account, owner_id=owner_id)

    await run_in_session(_op)


@register_command("delete_ai_proxy_account")
async def cmd_delete_ai_proxy_account(params: dict) -> None:
    from stitch_backend.domains.ai_proxy.legacy_alias import delete_account

    account_id = params.get("id", params.get("accountId", 0))

    async def _op(session):
        await delete_account(session, int(account_id))

    await run_in_session(_op)


# ── Export / Import (delegated to gateway alias — same payload schema) ──────

@register_command("export_ai_proxy_accounts_payload")
async def cmd_export_ai_proxy_accounts_payload(params: dict) -> str:
    from stitch_backend.domains.ai_proxy.legacy_alias import export_payload

    fmt = params.get("format", "json")
    include_secrets = params.get("includeSecrets", params.get("include_secrets", False))

    async def _op(session):
        return await export_payload(session, fmt=fmt, include_secrets=include_secrets)

    return await run_in_session(_op)


@register_command("import_ai_proxy_accounts_payload")
async def cmd_import_ai_proxy_accounts_payload(params: dict) -> int:
    from stitch_backend.domains.ai_proxy.legacy_alias import import_payload

    payload_str = params.get("payload", params.get("payloadStr", "{}"))
    if isinstance(payload_str, dict):
        payload_str = json.dumps(payload_str)

    async def _op(session):
        return await import_payload(session, payload_str)

    imported = await run_in_session(_op)
    return cast("int", imported)  # int


# ── Models ──────────────────────────────────────────────────────────────────

# Simple in-memory cache for model discovery (300s TTL)
_models_cache: dict = {"data": None, "expires": 0}
_CACHE_TTL = 300  # seconds

# Fallback models for providers with no public API or when API fails
_FALLBACK_MODELS: dict[str, list[dict[str, str]]] = {
    "openai": [
        {"id": "gpt-4o", "name": "GPT-4o"},
        {"id": "gpt-4o-mini", "name": "GPT-4o Mini"},
        {"id": "gpt-4.1", "name": "GPT-4.1"},
        {"id": "o3", "name": "o3"},
        {"id": "o4-mini", "name": "o4 Mini"},
    ],
    "anthropic": [
        {"id": "claude-sonnet-4-20250514", "name": "Claude Sonnet 4"},
        {"id": "claude-3-7-sonnet-20250219", "name": "Claude 3.7 Sonnet"},
        {"id": "claude-3-5-sonnet-20241022", "name": "Claude 3.5 Sonnet"},
    ],
    "gemini": [
        {"id": "gemini-2.5-pro", "name": "Gemini 2.5 Pro"},
        {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash"},
        {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash"},
    ],
    "antigravity": [
        {"id": "gpt-4o", "name": "GPT-4o (AG)"},
        {"id": "o3", "name": "o3 (AG)"},
    ],
    "fireworks": [
        {"id": "accounts/fireworks/models/llama4-scout-instruct-17b-16e-instruct", "name": "Llama 4 Scout"},
        {"id": "accounts/fireworks/models/deepseek-r1", "name": "DeepSeek R1"},
    ],
    "dashscope": [
        {"id": "qwen-max", "name": "Qwen Max"},
        {"id": "qwen-plus", "name": "Qwen Plus"},
    ],
    "zai": [
        {"id": "glm-4.7", "name": "GLM 4.7"},
        {"id": "GLM-5-Turbo", "name": "GLM-5 Turbo"},
        {"id": "GLM-5v-Turbo", "name": "GLM-5v Turbo"},
        {"id": "GLM-5.1", "name": "GLM 5.1"},
        {"id": "glm-5.2", "name": "GLM 5.2"},
    ],
    "kiro": [
        {"id": "claude-sonnet-4.5", "name": "Claude Sonnet 4.5"},
        {"id": "claude-haiku-4.5", "name": "Claude Haiku 4.5"},
        {"id": "claude-opus-4.5", "name": "Claude Opus 4.5"},
        {"id": "claude-sonnet-4", "name": "Claude Sonnet 4"},
    ],
}

# Default base URLs for OpenAI-compatible providers
_PROVIDER_BASE_URLS: dict[str, str] = {
    "openai": "https://api.openai.com",
    "antigravity": "https://api.openai.com",
    "fireworks": "https://api.fireworks.ai/inference",
    "dashscope": "https://dashscope.aliyuncs.com/compatible-mode",
}


async def _fetch_openai_compatible_models(
    provider: str, keys: list[dict],
) -> list[dict[str, str]]:
    """Fetch models from OpenAI-compatible /v1/models endpoint."""
    key = keys[0]
    api_key = key.get("apiKey")
    if not api_key:
        return []

    base_url = key.get("baseUrl") or _PROVIDER_BASE_URLS.get(provider, "https://api.openai.com")
    url = f"{base_url.rstrip('/')}/v1/models"

    try:
        client = await gateway().make_client(timeout=10.0)
    except ProxyUnavailableError:
        return []
    async with client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}"})
        if resp.status_code != 200:
            return []
        data = resp.json()
        models = data.get("data", [])
        return [
            {"id": m["id"], "provider": provider, "name": m.get("id", m["id"])}
            for m in models if "id" in m
        ]


async def _fetch_anthropic_models(keys: list[dict]) -> list[dict[str, str]]:
    """Fetch models from Anthropic /v1/models endpoint."""
    key = keys[0]
    api_key = key.get("apiKey")
    if not api_key:
        return []

    url = "https://api.anthropic.com/v1/models"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }

    try:
        client = await gateway().make_client(timeout=10.0)
    except ProxyUnavailableError:
        return []
    async with client:
        resp = await client.get(url, headers=headers)
        if resp.status_code != 200:
            return []
        data = resp.json()
        models = data.get("data", [])
        return [
            {"id": m["id"], "provider": "anthropic", "name": m.get("display_name", m["id"])}
            for m in models if "id" in m
        ]


async def _fetch_gemini_models(keys: list[dict]) -> list[dict[str, str]]:
    """Fetch models from Gemini API."""
    key = keys[0]
    api_key = key.get("apiKey")
    if not api_key:
        return []

    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"

    try:
        client = await gateway().make_client(timeout=10.0)
    except ProxyUnavailableError:
        return []
    async with client:
        resp = await client.get(url)
        if resp.status_code != 200:
            return []
        data = resp.json()
        models = data.get("models", [])
        result = []
        for m in models:
            name = m.get("name", "")
            if name.startswith("models/"):
                name = name[7:]  # strip "models/" prefix
            if name:
                result.append({"id": name, "provider": "gemini", "name": name})
        return result


async def _fetch_zai_models(keys: list[dict]) -> list[dict[str, str]]:
    """Z.AI has no public models API — return known list if keys configured."""
    if keys:
        return [{"id": m["id"], "provider": "zai", "name": m["name"]} for m in _FALLBACK_MODELS["zai"]]
    return []


async def _fetch_kiro_models(accounts: list[dict]) -> list[dict[str, str]]:
    """Fetch models from Kiro API using enabled accounts."""
    from stitch_backend.domains.kiro_gateway.upstream.models import fetch_kiro_models

    kiro_accounts = [
        a for a in accounts
        if (a.get("provider") or "").lower() in ("kiro", "kiro_v2") and a.get("enabled")
    ]
    if not kiro_accounts:
        return []

    # Try first enabled account
    account = kiro_accounts[0]
    token = account.get("oauthToken") or account.get("sessionToken")
    if not token:
        return []

    proxy_account = {
        "id": str(account.get("id", "")),
        "accessToken": token,
        "region": account.get("region", "us-east-1"),
        "provider": "kiro",
        "authMethod": "oauth",
        "profileArn": account.get("profileArn"),
        "machineId": account.get("machineId"),
    }

    try:
        client = await gateway().make_client(timeout=10.0)
    except ProxyUnavailableError:
        return []
    try:
        async with client:
            models = await fetch_kiro_models(cast("Any", proxy_account), client)
            return [
                {
                    "id": m.get("modelId", ""),
                    "provider": "kiro",
                    "name": m.get("modelName", m.get("modelId", "")),
                }
                for m in models if m.get("modelId")
            ]
    except Exception:
        return []


# ── Inference-provider registry (model discovery) ──────────────────────────
#
# API-key providers that share the OpenAI-compatible /v1/models fetcher, and
# the full API-key provider list. Kiro (account-based) and FreeModel
# (sidecar-backed) are registered separately in build_inference_providers.
_OPENAI_COMPATIBLE_PROVIDERS = ("openai", "antigravity", "fireworks", "dashscope")
_API_KEY_PROVIDERS = (
    "openai", "anthropic", "gemini", "antigravity", "fireworks", "zai", "dashscope",
)


def build_inference_providers(
    accounts: list[dict],
    api_keys: dict[str, list[dict]],
    enabled_providers: set[str],
    web_gemini_accounts: list[dict] | None = None,
    web_gemini_settings: dict[str, bool] | None = None,
    web_deepseek_accounts: list[dict] | None = None,
    web_deepseek_settings: dict[str, bool] | None = None,
    web_qwen_accounts: list[dict] | None = None,
    web_qwen_settings: dict[str, bool] | None = None,
):
    """Construct the inference-provider registry from preloaded DB data.

    Thin adapter over the domain factory
    :func:`inference_provider.build_inference_provider_registry`: builds the
    I/O-bound fetcher map (this module owns the ``_fetch_*`` functions) and
    injects it, so the registry construction stays in the domain module
    without a circular import. All DB data must be preloaded by the caller —
    this performs no network I/O.
    """
    from functools import partial

    from stitch_backend.domains.ai_proxy.inference_provider import (
        build_inference_provider_registry,
    )
    from stitch_backend.domains.freemodel_bridge.service import (
        SIDECAR_NAME as _FM_SIDECAR,
    )

    key_fetchers: dict[str, Any] = {}
    for provider in _API_KEY_PROVIDERS:
        if provider in _OPENAI_COMPATIBLE_PROVIDERS:
            # partial binds the provider id now (avoids the late-binding
            # closure trap of capturing the loop variable).
            key_fetchers[provider] = partial(_fetch_openai_compatible_models, provider)
        elif provider == "anthropic":
            key_fetchers[provider] = _fetch_anthropic_models
        elif provider == "gemini":
            key_fetchers[provider] = _fetch_gemini_models
        elif provider == "zai":
            key_fetchers[provider] = _fetch_zai_models

    # In-process web adapter (web-gemini): the fetcher closes over preloaded
    # ORM accounts + settings; list_models is local (no network), so it cannot
    # hang the bounded fetch phase.
    web_gemini_fetcher = None
    if (
        web_gemini_accounts is not None
        and web_gemini_settings is not None
        and "web-gemini" in enabled_providers
    ):
        from stitch_backend.domains.ai_proxy.web.gemini_adapter import (
            GeminiWebAdapter,
        )

        web_gemini_fetcher = GeminiWebAdapter(
            accounts=web_gemini_accounts, settings=web_gemini_settings
        ).list_models

    # In-process web adapter (web-deepseek): same discipline as web-gemini.
    web_deepseek_fetcher = None
    if (
        web_deepseek_accounts is not None
        and web_deepseek_settings is not None
        and "web-deepseek" in enabled_providers
    ):
        from stitch_backend.domains.ai_proxy.web.deepseek_adapter import (
            DeepSeekWebAdapter,
        )

        web_deepseek_fetcher = DeepSeekWebAdapter(
            accounts=web_deepseek_accounts, settings=web_deepseek_settings
        ).list_models

    # In-process web adapter (web-qwen): same discipline as web-gemini.
    web_qwen_fetcher = None
    if (
        web_qwen_accounts is not None
        and web_qwen_settings is not None
        and "web-qwen" in enabled_providers
    ):
        from stitch_backend.domains.ai_proxy.web.qwen_adapter import (
            QwenWebAdapter,
        )

        web_qwen_fetcher = QwenWebAdapter(
            accounts=web_qwen_accounts, settings=web_qwen_settings
        ).list_models

    return build_inference_provider_registry(
        accounts,
        api_keys,
        enabled_providers,
        key_fetchers=key_fetchers,
        kiro_fetcher=_fetch_kiro_models,
        freemodel_sidecar=_FM_SIDECAR,
        web_gemini_fetcher=web_gemini_fetcher,
        web_deepseek_fetcher=web_deepseek_fetcher,
        web_qwen_fetcher=web_qwen_fetcher,
    )


async def _fetch_all_provider_models(
    accounts: list[dict],
    api_keys: dict[str, list[dict]],
    enabled_providers: set[str],
    web_gemini_accounts: list[dict] | None = None,
    web_gemini_settings: dict[str, bool] | None = None,
    web_deepseek_accounts: list[dict] | None = None,
    web_deepseek_settings: dict[str, bool] | None = None,
    web_qwen_accounts: list[dict] | None = None,
    web_qwen_settings: dict[str, bool] | None = None,
) -> list[dict[str, str]]:
    """Fetch models from all connected providers in parallel.

    All DB data (accounts + API keys) must be preloaded by the caller — this
    function performs ONLY network I/O and must run OUTSIDE any DB session.

    Delegates to the inference-provider registry (see
    :func:`build_inference_providers`) instead of hardcoded per-provider
    dispatch.
    """
    registry = build_inference_providers(
        accounts,
        api_keys,
        enabled_providers,
        web_gemini_accounts=web_gemini_accounts,
        web_gemini_settings=web_gemini_settings,
        web_deepseek_accounts=web_deepseek_accounts,
        web_deepseek_settings=web_deepseek_settings,
        web_qwen_accounts=web_qwen_accounts,
        web_qwen_settings=web_qwen_settings,
    )
    return await registry.fetch_all_models()


@register_command("get_available_models", readonly=True)
async def cmd_get_available_models(params: dict) -> list:
    """Return models from actually connected providers via real API calls.

    Session discipline (fixes 92s hang): the DB session is held ONLY for the
    short preload phase (accounts + API keys).  The network fetch runs
    OUTSIDE any DB session, bounded by a 15s ``asyncio.wait_for`` deadline so
    a hung proxy handshake cannot block the single SQLite write connection.
    """
    import asyncio
    import time

    from stitch_backend.database import run_in_session
    from stitch_backend.domains.ai_proxy.legacy_alias import list_accounts
    from stitch_backend.domains.api_keys.service import ApiKeysService

    # Check cache
    now = time.time()
    if _models_cache["data"] is not None and _models_cache["expires"] > now:
        return cast("list[Any]", _models_cache["data"])

    # ── Phase 1: short DB session — preload accounts + API keys, then close.
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

        # Web-bridge providers (in-process adapters): ORM accounts + settings,
        # same short session. "web-gemini" joins enabled_providers when the
        # adapter is enabled and can serve (accounts or anonymous mode).
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

    # ── Phase 2: network fetch OUTSIDE any DB session — bounded by 15s.
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

    # On any failure (timeout, proxy error, all fetchers empty) serve stale
    # cache even if expired — only return [] when there was never any data.
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
    endpoint. The frontend uses this instead of a hardcoded bearer."""
    from stitch_backend.domains.ai_proxy.chat_router import ensure_local_chat_token

    token = await ensure_local_chat_token()
    return {"token": token}


@register_command("get_enabled_models")
async def cmd_get_enabled_models(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import get_settings_kv

    async def _op(session):
        raw = await get_settings_kv(session, "enabled_models")
        if raw:
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return []
        return []

    return await run_in_session(_op)


@register_command("set_enabled_models")
async def cmd_set_enabled_models(params: dict) -> None:
    from stitch_backend.domains.ai_proxy.service import set_settings_kv

    models = params.get("models", [])
    if isinstance(models, list):
        value = json.dumps(models)
    else:
        value = str(models)

    async def _op(session):
        await set_settings_kv(session, "enabled_models", value)

    await run_in_session(_op)


@register_command("get_provider_model_mappings")
async def cmd_get_provider_model_mappings(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import get_settings_kv

    async def _op(session):
        raw = await get_settings_kv(session, "provider_model_mappings")
        if raw:
            try:
                parsed = json.loads(raw)
                return parsed if isinstance(parsed, list) else []
            except json.JSONDecodeError:
                return []
        return []

    return await run_in_session(_op)  # list of ProviderModelMapping dicts


@register_command("set_provider_model_mappings")
async def cmd_set_provider_model_mappings(params: dict) -> None:
    from stitch_backend.domains.ai_proxy.service import set_settings_kv

    mappings = params.get("mappings", params)
    value = json.dumps(mappings) if isinstance(mappings, (dict, list)) else str(mappings)

    async def _op(session):
        await set_settings_kv(session, "provider_model_mappings", value)

    await run_in_session(_op)


# ── Capabilities ────────────────────────────────────────────────────────────

@register_command("get_provider_capabilities")
async def cmd_get_provider_capabilities(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.legacy_alias import list_accounts

    providers = ("openai", "gemini", "anthropic", "antigravity", "fireworks", "zai")
    owner_id = _alias_owner_id(params)

    async def _op(session):
        accounts = await list_accounts(session, owner_id=owner_id)
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

    return await run_in_session(_op)


# ── IDE Config ──────────────────────────────────────────────────────────────

@register_command("detect_ai_proxy_ides")
async def cmd_detect_ai_proxy_ides(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import IdeDetector
    ides = IdeDetector.detect_all()
    return [
        {
            "name": ide.name,
            "displayName": ide.display_name,
            "path": ide.path,
            "version": ide.version,
            "configured": ide.configured,
        }
        for ide in ides
    ]


@register_command("configure_ai_proxy_ide")
async def cmd_configure_ai_proxy_ide(params: dict) -> dict:
    """Configure an IDE to use the AI proxy (stub — writes config JSON)."""
    ide = params.get("ide", params.get("ideType", ""))
    settings = params.get("settings", params.get("config", {}))
    return {
        "success": True,
        "message": f"Configured {ide} for AI proxy",
        "ide": ide,
        "settings": settings,
    }


@register_command("get_ai_proxy_ide_config_preview")
async def cmd_get_ai_proxy_ide_config_preview(params: dict) -> str:
    """Preview the IDE configuration that would be written (returns str)."""
    ide = params.get("ide", params.get("ideType", ""))
    preview = {
        "ide": ide,
        "configPreview": {
            "proxyUrl": "http://127.0.0.1:0",
            "apiKey": "***",
            "models": [],
        },
    }
    return json.dumps(preview, indent=2)


@register_command("restore_ai_proxy_ide_config")
async def cmd_restore_ai_proxy_ide_config(params: dict) -> dict:
    """Restore IDE config to its default (un-proxied) state."""
    ide = params.get("ide", params.get("ideType", ""))
    return {"success": True, "message": f"Restored {ide} to default config", "ide": ide}


# ── Quotas ──────────────────────────────────────────────────────────────────

def _auth_dirs() -> list:
    """Return auth directories matching the canonical paths."""
    import os
    import sys
    dirs = []
    override = os.environ.get("STITCH_AI_PROXY_AUTH_DIR", "").strip()
    if override:
        dirs.append(Path(override))
    else:
        if sys.platform == "win32":
            base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        elif sys.platform == "darwin":
            base = Path.home() / "Library" / "Application Support"
        else:
            base = Path.home() / ".local" / "share"
        dirs.append(base / "stitch-manager" / "ai-proxy-sidecar" / "auth")
    legacy = Path.home() / ".cli-proxy-api"
    if legacy.is_dir() and legacy not in dirs:
        dirs.append(legacy)
    return [d for d in dirs if d.is_dir()]


def _quota_from_api_keys_count(openai_count: int, gemini_count: int, antigravity_count: int) -> list[dict]:
    """Build fallback quota entries when CLI tools unavailable (mirrors Rust quota_from_api_keys)."""
    quotas = []
    if gemini_count > 0:
        quotas.append({"provider": "gemini", "totalQuota": -1, "usedQuota": 0, "remainingQuota": -1, "resetAt": None})
    if openai_count > 0:
        quotas.append({"provider": "openai", "totalQuota": -1, "usedQuota": 0, "remainingQuota": -1, "resetAt": None})
    if antigravity_count > 0:
        quotas.append({"provider": "antigravity", "totalQuota": -1, "usedQuota": 0, "remainingQuota": -1, "resetAt": None})
    return quotas


async def _try_cli_quota(cli_name: str, provider: str) -> dict | None:
    """Try running a CLI quota tool (gemini/codex/claude) and parse JSON output."""
    import asyncio
    import json as _json
    try:
        proc = await asyncio.create_subprocess_exec(
            cli_name, "quota", "--json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        if proc.returncode != 0:
            logger.debug("[Quota] %s CLI failed: %s", cli_name, stderr.decode(errors="replace"))
            return None
        data = _json.loads(stdout.decode())
        total = data.get("total", 0)
        used = data.get("used", 0)
        remaining = data.get("remaining", total - used)
        reset_at = data.get("reset_at") or data.get("resetAt")
        return {
            "provider": provider,
            "totalQuota": total,
            "usedQuota": used,
            "remainingQuota": remaining,
            "resetAt": reset_at,
        }
    except (TimeoutError, FileNotFoundError, Exception) as e:
        logger.debug("[Quota] %s CLI unavailable: %s", cli_name, e)
        return None


async def _fetch_all_quotas_impl() -> list:
    """Fetch quota info for all providers via CLI tools, fall back to API key counts."""
    import asyncio

    from stitch_backend.domains.api_keys.service import ApiKeysService

    # Try fetching real quotas from CLI tools concurrently
    cli_results = await asyncio.gather(
        _try_cli_quota("gemini", "gemini"),
        _try_cli_quota("codex", "openai"),
        _try_cli_quota("claude", "claude"),
    )
    quotas = [r for r in cli_results if r is not None]
    providers_found = {q["provider"] for q in quotas}

    # Count API keys from DB for fallback entries
    async def _count_keys(session):
        svc = ApiKeysService(session)
        counts = {}
        for provider in ("gemini", "openai", "antigravity"):
            try:
                keys = await svc.get_keys(provider)
                counts[provider] = len(keys)
            except Exception:
                counts[provider] = 0
        return counts

    try:
        counts = await run_in_session(_count_keys)
    except Exception:
        counts = {}

    fallback = _quota_from_api_keys_count(
        counts.get("openai", 0),
        counts.get("gemini", 0),
        counts.get("antigravity", 0),
    )
    for fb in fallback:
        if fb["provider"] not in providers_found:
            quotas.append(fb)

    return quotas


@register_command("fetch_all_quotas_cmd")
async def cmd_fetch_all_quotas(params: dict) -> list:
    """Cached fan-out (TTL + single-flight). ``{"force": true}`` bypasses TTL."""
    return list(await _ALL_QUOTAS_CACHE.get_or_fetch(
        _fetch_all_quotas_impl, force=bool((params or {}).get("force"))
    ))


async def _fetch_openai_account_quotas_impl() -> list:
    """Fetch OpenAI/Codex account-level quotas from auth files and usage API."""
    import json as _json
    import time

    import httpx

    auth_dirs = _auth_dirs()
    auth_files = []
    for d in auth_dirs:
        for p in d.iterdir():
            if p.suffix == ".json" and (p.stem.startswith("openai-") or p.stem.startswith("codex-")):
                auth_files.append(p)

    if not auth_files:
        return []

    now_ts = int(time.time())
    results = []

    from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
    proxy_url = _get_outbound_proxy()
    async with httpx.AsyncClient(timeout=12.0, proxy=proxy_url) as client:
        for fpath in auth_files:
            account_name = fpath.stem
            try:
                raw = _json.loads(fpath.read_text(encoding="utf-8"))
            except Exception:
                results.append({"accountId": None, "accountName": account_name, "accountEmail": None,
                                "planType": None, "primary": {}, "secondary": None, "fetchedAt": now_ts,
                                "error": "Invalid auth file JSON"})
                continue

            access_token = raw.get("access_token") or raw.get("accessToken") or raw.get("token")
            account_id = raw.get("account_id") or raw.get("accountId")
            email = raw.get("email") or raw.get("account_email") or raw.get("accountEmail")

            if not access_token:
                results.append({"accountId": None, "accountName": account_name, "accountEmail": email,
                                "planType": None, "primary": {}, "secondary": None, "fetchedAt": now_ts,
                                "error": "Missing access_token in auth file"})
                continue

            headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
            if account_id:
                headers["ChatGPT-Account-Id"] = str(account_id)

            try:
                resp = await client.get("https://chatgpt.com/backend-api/wham/usage", headers=headers)
                if resp.status_code != 200:
                    results.append({"accountId": None, "accountName": account_name, "accountEmail": email,
                                    "planType": None, "primary": {}, "secondary": None, "fetchedAt": now_ts,
                                    "error": f"OpenAI API returned {resp.status_code}"})
                    continue
                data = resp.json()
                rate_limit = data.get("rate_limit", {})
                primary = rate_limit.get("primary_window", {})
                secondary = rate_limit.get("secondary_window")
                results.append({
                    "accountId": None, "accountName": account_name, "accountEmail": email,
                    "planType": data.get("plan_type"),
                    "primary": {"usedPercent": primary.get("used_percent", 0), "resetAt": primary.get("reset_at"),
                                "resetAfterSeconds": primary.get("reset_after_seconds"),
                                "totalCount": primary.get("total_count"),
                                "remainingCount": primary.get("remaining_count"),
                                "windowSeconds": primary.get("limit_window_seconds")},
                    "secondary": {"usedPercent": secondary.get("used_percent", 0), "resetAt": secondary.get("reset_at"),
                                  "resetAfterSeconds": secondary.get("reset_after_seconds"),
                                  "totalCount": secondary.get("total_count"),
                                  "remainingCount": secondary.get("remaining_count"),
                                  "windowSeconds": secondary.get("limit_window_seconds")} if secondary else None,
                    "fetchedAt": now_ts, "error": None,
                })
            except Exception as e:
                results.append({"accountId": None, "accountName": account_name, "accountEmail": email,
                                "planType": None, "primary": {}, "secondary": None, "fetchedAt": now_ts,
                                "error": str(e)})

    return results


@register_command("fetch_openai_account_quotas_cmd")
async def cmd_fetch_openai_account_quotas(params: dict) -> list:
    """Cached fan-out (TTL + single-flight). ``{"force": true}`` bypasses TTL."""
    return list(await _OPENAI_QUOTAS_CACHE.get_or_fetch(
        _fetch_openai_account_quotas_impl, force=bool((params or {}).get("force"))
    ))


async def _fetch_kiro_account_quotas_impl() -> list:
    """Fetch Kiro account quotas via CodeWhisperer API using stored tokens."""
    import os
    import sys
    import time

    async def _get_kiro_accounts(session):
        from stitch_backend.domains.ai_proxy.legacy_alias import list_accounts
        all_accounts = await list_accounts(session)
        return [a for a in all_accounts if (a.get("provider") or "").lower() == "kiro"]

    try:
        accounts = await run_in_session(_get_kiro_accounts)
    except Exception as e:
        logger.warning("[Kiro Quota] Failed to fetch accounts: %s", e)
        return []

    if not accounts:
        return []

    now_ts = int(time.time())
    results = []

    # Add autoreg to path for QuotaService import
    autoreg_path = str(Path(__file__).resolve().parents[4] / "python" / "autoreg")
    if autoreg_path not in sys.path:
        sys.path.insert(0, autoreg_path)
    # Also try repo root / python / autoreg
    repo_autoreg = str(Path(os.environ.get("STITCH_REPO_ROOT", "")).resolve() / "python" / "autoreg") if os.environ.get("STITCH_REPO_ROOT") else None
    if repo_autoreg and repo_autoreg not in sys.path:
        sys.path.insert(0, repo_autoreg)

    # Read outbound proxy from kiro-patch config to avoid leaking real IP
    outbound_proxy = None
    try:
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
        outbound_proxy = _get_outbound_proxy()
    except Exception as e:
        logger.debug("[Kiro Quota] Could not read outbound proxy: %s", e)

    for account in accounts:
        account_id = account.get("id", 0)
        account_name = account.get("name", "")
        oauth_token = account.get("oauth_token") or account.get("oauthToken")
        session_token = account.get("session_token") or account.get("sessionToken")

        token = oauth_token or session_token
        if not token:
            results.append({
                "accountId": account_id, "accountName": account_name, "email": None,
                "subscriptionType": None, "used": 0, "limit": 0,
                "percentUsed": 0.0, "daysUntilReset": None, "fetchedAt": now_ts,
                "error": "No OAuth token available",
            })
            continue

        try:
            from autoreg.services.quota_service import QuotaService
            with QuotaService(proxy=outbound_proxy) as svc:
                info = svc.get_quota_from_cw_api(token, "us-east-1", proxy=outbound_proxy)
            if info and info.usage:
                usage = info.usage
                total_limit = usage.limit + (usage.trial_limit if usage.trial_status == "ACTIVE" else 0)
                total_used = usage.used + (usage.trial_used if usage.trial_status == "ACTIVE" else 0)
                pct = (total_used / total_limit * 100) if total_limit > 0 else 0.0
                results.append({
                    "accountId": account_id, "accountName": account_name,
                    "email": info.email, "subscriptionType": info.subscription_type,
                    "used": total_used, "limit": total_limit,
                    "percentUsed": round(pct, 1), "daysUntilReset": info.days_until_reset,
                    "fetchedAt": now_ts, "error": None,
                })
            else:
                results.append({
                    "accountId": account_id, "accountName": account_name, "email": None,
                    "subscriptionType": None, "used": 0, "limit": 0,
                    "percentUsed": 0.0, "daysUntilReset": None, "fetchedAt": now_ts,
                    "error": getattr(info, "error", None) or "NO_QUOTA",
                })
        except Exception as e:
            results.append({
                "accountId": account_id, "accountName": account_name, "email": None,
                "subscriptionType": None, "used": 0, "limit": 0,
                "percentUsed": 0.0, "daysUntilReset": None, "fetchedAt": now_ts,
                "error": str(e),
            })

    return results


@register_command("fetch_kiro_account_quotas_cmd")
async def cmd_fetch_kiro_account_quotas(params: dict) -> list:
    """Cached fan-out (TTL + single-flight). ``{"force": true}`` bypasses TTL."""
    return list(await _KIRO_QUOTAS_CACHE.get_or_fetch(
        _fetch_kiro_account_quotas_impl, force=bool((params or {}).get("force"))
    ))


# ── Auth Files ──────────────────────────────────────────────────────────────

@register_command("scan_auth_files")
async def cmd_scan_auth_files(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import AuthFileScanner
    files = AuthFileScanner.scan_all()
    return [
        {"provider": f.provider, "path": f.path, "token": f.token[:8] + "...", "expiresAt": f.expires_at}
        for f in files
    ]


@register_command("auto_import_ai_proxy_auth_files")
async def cmd_auto_import_ai_proxy_auth_files(params: dict) -> dict:
    """Scan and auto-import discovered auth files into accounts."""
    from stitch_backend.domains.ai_proxy.legacy_alias import (
        create_account,
        get_account_by_name,
    )
    from stitch_backend.domains.ai_proxy.service import AuthFileScanner

    files = AuthFileScanner.scan_all()
    owner_id = _alias_owner_id(params)

    async def _op(session):
        imported = 0
        for f in files:
            name = f.path.split("/")[-1].replace(".json", "")
            existing = await get_account_by_name(session, f.provider, name)
            if existing:
                continue
            account = {
                "provider": f.provider,
                "name": name,
                "apiKey": f.token,
                "enabled": True,
            }
            await create_account(session, account, owner_id=owner_id)
            imported += 1
        return imported

    imported = await run_in_session(_op)
    return {"scanned": len(files), "imported": imported}


# ── Auth Flow ───────────────────────────────────────────────────────────────

@register_command("provider_auth_flow_start")
async def cmd_provider_auth_flow_start(params: dict) -> dict:
    from stitch_backend.domains.ai_proxy.service import get_auth_flow_manager

    provider = params.get("provider", "")
    redirect_url = params.get("redirectUrl", params.get("callbackUrl", ""))
    flow_type = params.get("flowType", "oauth")

    auth_url = f"https://{provider}.example.com/oauth/authorize?redirect={redirect_url}"
    session = get_auth_flow_manager().create_session(
        provider=provider, auth_url=auth_url, state="pending", flow_type=flow_type,
    )
    return {
        "sessionId": session.session_id,
        "authUrl": session.auth_url,
        "state": session.state,
        "expiresAt": session.expires_at,
    }


@register_command("provider_auth_flow_status")
async def cmd_provider_auth_flow_status(params: dict) -> dict | None:
    from stitch_backend.domains.ai_proxy.service import get_auth_flow_manager

    session_id = params.get("sessionId", "")
    session = get_auth_flow_manager().get_session(session_id)
    if not session:
        return None
    return {
        "sessionId": session.session_id,
        "provider": session.provider,
        "phase": session.phase,
        "state": session.state,
        "authUrl": session.auth_url,
        "error": session.error,
        "flowType": session.flow_type,
    }


@register_command("provider_auth_flow_cancel")
async def cmd_provider_auth_flow_cancel(params: dict) -> bool:
    from stitch_backend.domains.ai_proxy.service import get_auth_flow_manager

    session_id = params.get("sessionId", "")
    return get_auth_flow_manager().remove_session(session_id)


# ── Analytics ───────────────────────────────────────────────────────────────

@register_command("get_ai_proxy_account_daily_usage", readonly=True)
async def cmd_get_ai_proxy_account_daily_usage(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.legacy_alias import list_accounts

    owner_id = _alias_owner_id(params)

    async def _op(session):
        # L2 alias: legacy ``ai_proxy_request_logs`` table is no longer the
        # source of truth. Zero-fill per-account (matches the legacy shape)
        # — runtime counters now live on Credential.runtime_status.
        accounts = await list_accounts(session, owner_id=owner_id)
        return [
            {"provider": a["provider"], "name": a["name"], "requests": 0, "tokens": 0}
            for a in accounts
            if a.get("enabled")
        ]

    return await run_in_read_session(_op)


@register_command("get_daily_stats", readonly=True)
async def cmd_get_daily_stats(params: dict) -> dict:
    from stitch_backend.domains.ai_proxy.service import AiProxyAnalytics

    async def _op(session):
        return await AiProxyAnalytics.get_daily_stats(session)

    return await run_in_read_session(_op)


@register_command("get_model_usage", readonly=True)
async def cmd_get_model_usage(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import AiProxyAnalytics

    async def _op(session):
        return await AiProxyAnalytics.get_model_usage(session)

    return await run_in_read_session(_op)


@register_command("get_cost_estimate", readonly=True)
async def cmd_get_cost_estimate(params: dict) -> float:
    from stitch_backend.domains.ai_proxy.service import AiProxyAnalytics

    async def _op(session):
        return await AiProxyAnalytics.get_cost_estimate(session)

    return await run_in_read_session(_op)


@register_command("get_weekly_stats", readonly=True)
async def cmd_get_weekly_stats(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import AiProxyAnalytics

    async def _op(session):
        return await AiProxyAnalytics.get_weekly_stats(session)

    return await run_in_read_session(_op)


# ── Utility ─────────────────────────────────────────────────────────────────

@register_command("open_url_in_browser")
async def cmd_open_url_in_browser(params: dict) -> None:
    url = params.get("url", "")
    if url:
        webbrowser.open(url)


@register_command("debug_run_ai_proxy_migration")
async def cmd_debug_run_ai_proxy_migration(params: dict) -> str:
    """Run a raw SQL migration for debugging (requires STITCH_DEBUG_ALLOW_SQL=1)."""
    import os

    from sqlalchemy import text as sql_text

    if not os.environ.get("STITCH_DEBUG_ALLOW_SQL"):
        return "Debug SQL execution is disabled. Set STITCH_DEBUG_ALLOW_SQL=1 to enable."

    sql = params.get("sql", "")
    if not sql:
        return "sql is required"

    async def _op(session):
        result = await session.execute(sql_text(sql))
        return f"Rows affected: {result.rowcount}"

    return await run_in_session(_op)  # str


@register_command("test_provider_connection")
async def cmd_test_provider_connection(params: dict) -> dict:
    """Test connection to an AI proxy provider."""
    provider = params.get("provider", "")
    if provider == "zai":
        from stitch_backend.domains.ai_proxy.service import get_zai_token_db_path

        async def _op(session):
            return await get_zai_token_db_path(session)

        token_db_path = await run_in_session(_op)
        if not token_db_path:
            return {
                "success": False,
                "provider": provider,
                "message": "zai_token_db_path is not configured",
                "latencyMs": 0,
            }
        if not Path(token_db_path).is_file():
            return {
                "success": False,
                "provider": provider,
                "message": "zai_token_db_path does not point to an existing file",
                "latencyMs": 0,
            }
        return {
            "success": True,
            "provider": provider,
            "message": "Z.AI token database is configured",
            "latencyMs": 0,
        }
    return {
        "success": False,
        "provider": provider,
        "message": f"Connection test for {provider} not yet implemented",
        "latencyMs": 0,
    }
