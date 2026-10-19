"""Inference-provider registry (model discovery) and per-provider fetchers.

API-key providers that share the OpenAI-compatible /v1/models fetcher, and
the full API-key provider list. Kiro (account-based) and FreeModel
(sidecar-backed) are registered separately in build_inference_providers.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

from stitch_backend.core.http_gateway import ProxyUnavailableError, gateway
from stitch_backend.core.provider_defaults import PROVIDER_DEFAULTS

if TYPE_CHECKING:
    from stitch_backend.domains.ai_proxy.inference_provider import (
        InferenceProviderRegistry,
    )

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


async def _fetch_openai_compatible_models(
    provider: str, keys: list[dict],
) -> list[dict[str, str]]:
    """Fetch models from OpenAI-compatible /v1/models endpoint."""
    key = keys[0]
    api_key = key.get("apiKey")
    if not api_key:
        return []

    defaults = PROVIDER_DEFAULTS.get(provider)
    fallback = defaults.base_url if defaults else None
    base_url = key.get("baseUrl") or fallback or "https://api.openai.com"
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
) -> InferenceProviderRegistry:
    """Construct the inference-provider registry from preloaded DB data.

    Thin adapter over the domain factory
    :func:`inference_provider.build_inference_provider_registry`: builds the
    I/O-bound fetcher map (this module owns the ``_fetch_*`` functions) and
    injects it, so the registry construction stays in the domain module
    without a circular import. All DB data must be preloaded by the caller —
    this performs no network I/O.
    """
    from functools import partial

    from stitch_backend.domains.ai_proxy.freemodel_sidecar import (
        SIDECAR_NAME as _FM_SIDECAR,
    )
    from stitch_backend.domains.ai_proxy.freemodel_sidecar import (
        resolve_endpoint as _fm_resolve_endpoint,
    )
    from stitch_backend.domains.ai_proxy.inference_provider import (
        build_inference_provider_registry,
    )
    from stitch_backend.domains.ai_proxy.notion_bridge import (
        SIDECAR_NAME as _NB_SIDECAR,
    )
    from stitch_backend.domains.ai_proxy.notion_bridge import (
        resolve_endpoint as _nb_resolve_endpoint,
    )

    key_fetchers: dict[str, Any] = {}
    for provider in _API_KEY_PROVIDERS:
        if provider in _OPENAI_COMPATIBLE_PROVIDERS:
            # partial binds the provider id now — avoids the late-binding closure trap.
            key_fetchers[provider] = partial(_fetch_openai_compatible_models, provider)
        elif provider == "anthropic":
            key_fetchers[provider] = _fetch_anthropic_models
        elif provider == "gemini":
            key_fetchers[provider] = _fetch_gemini_models
        elif provider == "zai":
            key_fetchers[provider] = _fetch_zai_models

    # In-process web adapter (web-gemini): list_models is local (no network).
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
        freemodel_endpoint_fallback=_fm_resolve_endpoint,
        notion_sidecar=_NB_SIDECAR,
        notion_endpoint_fallback=_nb_resolve_endpoint,
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
    :func:`build_inference_providers`); no per-provider dispatch lives here.
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
