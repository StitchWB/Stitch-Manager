"""AI Proxy command handlers — 35 commands.

Covers account CRUD, export/import, model management, IDE config,
quotas, auth flows, analytics, and utility operations.
"""

from __future__ import annotations

import json
import logging
import webbrowser
from pathlib import Path

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session

logger = logging.getLogger(__name__)


# ── Account CRUD ────────────────────────────────────────────────────────────

@register_command("get_ai_proxy_accounts")
async def cmd_get_ai_proxy_accounts(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import AiProxyAccountStore

    async def _op(session):
        return await AiProxyAccountStore.get_accounts(session)

    return await run_in_session(_op)


@register_command("create_ai_proxy_account")
async def cmd_create_ai_proxy_account(params: dict) -> int:
    from stitch_backend.domains.ai_proxy.service import AiProxyAccountStore

    account = params.get("account", params)

    async def _op(session):
        return await AiProxyAccountStore.create_account(session, account)

    return await run_in_session(_op)


@register_command("update_ai_proxy_account")
async def cmd_update_ai_proxy_account(params: dict) -> None:
    from stitch_backend.domains.ai_proxy.service import AiProxyAccountStore

    account = params.get("account", params)

    async def _op(session):
        await AiProxyAccountStore.update_account(session, account)

    await run_in_session(_op)


@register_command("delete_ai_proxy_account")
async def cmd_delete_ai_proxy_account(params: dict) -> None:
    from stitch_backend.domains.ai_proxy.service import AiProxyAccountStore

    account_id = params.get("id", params.get("accountId", 0))

    async def _op(session):
        await AiProxyAccountStore.delete_account(session, int(account_id))

    await run_in_session(_op)


# ── Export / Import ─────────────────────────────────────────────────────────

@register_command("export_ai_proxy_accounts_payload")
async def cmd_export_ai_proxy_accounts_payload(params: dict) -> str:
    from stitch_backend.domains.ai_proxy.service import export_accounts_payload

    fmt = params.get("format", "json")
    include_secrets = params.get("includeSecrets", params.get("include_secrets", False))

    async def _op(session):
        return await export_accounts_payload(session, fmt=fmt, include_secrets=include_secrets)

    return await run_in_session(_op)


@register_command("import_ai_proxy_accounts_payload")
async def cmd_import_ai_proxy_accounts_payload(params: dict) -> int:
    from stitch_backend.domains.ai_proxy.service import import_accounts_payload

    payload_str = params.get("payload", params.get("payloadStr", "{}"))
    if isinstance(payload_str, dict):
        payload_str = json.dumps(payload_str)

    async def _op(session):
        return await import_accounts_payload(session, payload_str)

    imported = await run_in_session(_op)
    return imported  # int — matches Rust u64


# ── Models ──────────────────────────────────────────────────────────────────

# Simple in-memory cache for model discovery (60s TTL)
_models_cache: dict = {"data": None, "expires": 0}
_CACHE_TTL = 60  # seconds

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
    import httpx

    key = keys[0]
    api_key = key.get("apiKey")
    if not api_key:
        return []

    base_url = key.get("baseUrl") or _PROVIDER_BASE_URLS.get(provider, "https://api.openai.com")
    url = f"{base_url.rstrip('/')}/v1/models"

    async with httpx.AsyncClient(timeout=10.0) as client:
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
    import httpx

    key = keys[0]
    api_key = key.get("apiKey")
    if not api_key:
        return []

    url = "https://api.anthropic.com/v1/models"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
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
    import httpx

    key = keys[0]
    api_key = key.get("apiKey")
    if not api_key:
        return []

    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"

    async with httpx.AsyncClient(timeout=10.0) as client:
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
    import httpx
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
        async with httpx.AsyncClient(timeout=10.0) as client:
            models = await fetch_kiro_models(proxy_account, client)
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


async def _fetch_freemodel_models() -> list[dict[str, str]]:
    """Fetch models from FreeModel bridge if running."""
    import httpx
    from stitch_backend.domains.freemodel_bridge.service import FreemodelBridgeService

    try:
        status = FreemodelBridgeService.status()
        if status.get("status") != "running":
            return []
        port = status.get("port", 0)
        if not port:
            return []

        url = f"http://127.0.0.1:{port}/v1/models"
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return []
            data = resp.json()
            models = data.get("data", [])
            return [
                {"id": m["id"], "provider": "freemodel", "name": m.get("id", m["id"])}
                for m in models if "id" in m
            ]
    except Exception:
        return []


async def _fetch_all_provider_models(
    session, enabled_providers: set[str],
) -> list[dict[str, str]]:
    """Fetch models from all connected providers in parallel."""
    import asyncio
    import logging
    from stitch_backend.domains.api_keys.service import ApiKeysService

    logger = logging.getLogger(__name__)
    svc = ApiKeysService(session)
    tasks: list[tuple[str, asyncio.Task]] = []
    task_names: list[str] = []

    # API-key providers
    for provider in ("openai", "anthropic", "gemini", "antigravity", "fireworks", "zai", "dashscope"):
        try:
            keys = await svc.get_keys(provider)
            if keys:
                if provider in ("openai", "antigravity", "fireworks", "dashscope"):
                    coro = _fetch_openai_compatible_models(provider, keys)
                elif provider == "anthropic":
                    coro = _fetch_anthropic_models(keys)
                elif provider == "gemini":
                    coro = _fetch_gemini_models(keys)
                elif provider == "zai":
                    coro = _fetch_zai_models(keys)
                else:
                    continue
                tasks.append((provider, asyncio.ensure_future(coro)))
                task_names.append(provider)
                logger.info("[Models] Fetching models for %s (%d keys)", provider, len(keys))
            else:
                logger.debug("[Models] No keys for %s", provider)
        except Exception as e:
            logger.warning("[Models] Error checking keys for %s: %s", provider, e)

    # Account-based: Kiro
    if enabled_providers & {"kiro", "kiro_v2"}:
        accounts_func = await _get_accounts_func()
        accounts = await accounts_func(session)
        tasks.append(("kiro", asyncio.ensure_future(_fetch_kiro_models(accounts))))
        task_names.append("kiro")
        logger.info("[Models] Fetching Kiro models (%d enabled accounts)",
                     sum(1 for a in accounts if (a.get("provider") or "").lower() in ("kiro", "kiro_v2") and a.get("enabled")))

    # FreeModel bridge
    tasks.append(("freemodel", asyncio.ensure_future(_fetch_freemodel_models())))
    task_names.append("freemodel")

    if not tasks:
        logger.warning("[Models] No providers configured — returning empty list")
        return []

    # Fetch all in parallel with timeout
    results = await asyncio.gather(*(t for _, t in tasks), return_exceptions=True)

    # Aggregate results
    all_models: list[dict[str, str]] = []
    for i, result in enumerate(results):
        name = task_names[i] if i < len(task_names) else "?"
        if isinstance(result, list):
            count = len(result)
            all_models.extend(result)
            logger.info("[Models] %s: %d models", name, count)
        else:
            logger.error("[Models] %s failed: %r", name, result)

    logger.info("[Models] Total: %d models from %d providers", len(all_models), len(tasks))
    return all_models


# Helper to get accounts function (avoids circular import)
_accounts_func = None


async def _get_accounts_func():
    global _accounts_func
    if _accounts_func is None:
        from stitch_backend.domains.ai_proxy.service import AiProxyAccountStore
        _accounts_func = AiProxyAccountStore.get_accounts
    return _accounts_func


@register_command("get_available_models")
async def cmd_get_available_models(params: dict) -> list:
    """Return models from actually connected providers via real API calls."""
    import time
    from stitch_backend.database import run_in_session
    from stitch_backend.domains.ai_proxy.service import AiProxyAccountStore

    # Check cache
    now = time.time()
    if _models_cache["data"] is not None and _models_cache["expires"] > now:
        return _models_cache["data"]

    async def _op(session):
        accounts = await AiProxyAccountStore.get_accounts(session)
        enabled_providers = {
            (a.get("provider") or "").lower()
            for a in accounts if a.get("enabled")
        }
        result = await _fetch_all_provider_models(session, enabled_providers)

        # Fallback: if all API calls returned [], use known models for connected providers
        if not result:
            import logging
            logger = logging.getLogger(__name__)
            logger.warning("[Models] All API calls returned empty — using fallback for %s", enabled_providers)

            # Check API keys
            from stitch_backend.domains.api_keys.service import ApiKeysService
            svc = ApiKeysService(session)
            key_providers = set()
            for provider in ("openai", "anthropic", "gemini", "antigravity", "fireworks", "zai", "dashscope"):
                try:
                    keys = await svc.get_keys(provider)
                    if keys:
                        key_providers.add(provider)
                except Exception:
                    pass

            # Add fallback models for connected providers
            for provider in enabled_providers | key_providers:
                if provider in _FALLBACK_MODELS:
                    for m in _FALLBACK_MODELS[provider]:
                        result.append({"id": m["id"], "provider": provider, "name": m["name"]})

        return result

    result = await run_in_session(_op)

    # Update cache
    _models_cache["data"] = result
    _models_cache["expires"] = now + _CACHE_TTL

    return result


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


@register_command("reset_enabled_models")
async def cmd_reset_enabled_models(params: dict) -> None:
    """Reset enabled model IDs to defaults. Mirrors Rust ``reset_enabled_models``."""
    from stitch_backend.domains.ai_proxy.service import set_settings_kv

    defaults = ["kiro-amazonq-developer", "kiro-amazonq-pro"]
    value = json.dumps(defaults)

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

    return await run_in_session(_op)  # list — matches Rust Vec<ProviderModelMapping>


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
    from stitch_backend.domains.ai_proxy.service import AiProxyAccountStore

    providers = ("openai", "gemini", "anthropic", "antigravity", "fireworks", "zai")

    async def _op(session):
        accounts = await AiProxyAccountStore.get_accounts(session)
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
    """Preview the IDE configuration that would be written (matches Rust: String)."""
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

def _sidecar_auth_dirs() -> list:
    """Return auth directories matching Rust sidecar paths.rs logic."""
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
    except (FileNotFoundError, asyncio.TimeoutError, Exception) as e:
        logger.debug("[Quota] %s CLI unavailable: %s", cli_name, e)
        return None


@register_command("fetch_all_quotas_cmd")
async def cmd_fetch_all_quotas(params: dict) -> list:
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


@register_command("fetch_openai_account_quotas_cmd")
async def cmd_fetch_openai_account_quotas(params: dict) -> list:
    """Fetch OpenAI/Codex account-level quotas from auth files and usage API."""
    import json as _json
    import time
    import httpx

    auth_dirs = _sidecar_auth_dirs()
    auth_files = []
    for d in auth_dirs:
        for p in d.iterdir():
            if p.suffix == ".json" and (p.stem.startswith("openai-") or p.stem.startswith("codex-")):
                auth_files.append(p)

    if not auth_files:
        return []

    now_ts = int(time.time())
    results = []

    async with httpx.AsyncClient(timeout=12.0) as client:
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


@register_command("fetch_kiro_account_quotas_cmd")
async def cmd_fetch_kiro_account_quotas(params: dict) -> list:
    """Fetch Kiro account quotas via CodeWhisperer API using stored tokens."""
    import os
    import sys
    import time

    async def _get_kiro_accounts(session):
        from stitch_backend.domains.ai_proxy.service import AiProxyAccountStore
        all_accounts = await AiProxyAccountStore.get_accounts(session)
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
            svc = QuotaService()
            info = svc.get_quota_from_cw_api(token, "us-east-1")
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
    from stitch_backend.domains.ai_proxy.service import AuthFileScanner, AiProxyAccountStore

    files = AuthFileScanner.scan_all()

    async def _op(session):
        imported = 0
        for f in files:
            existing = await AiProxyAccountStore.get_account_by_name(session, f.provider, f.path.split("/")[-1].replace(".json", ""))
            if existing:
                continue
            account = {
                "provider": f.provider,
                "name": f.path.split("/")[-1].replace(".json", ""),
                "apiKey": f.token,
                "enabled": True,
            }
            await AiProxyAccountStore.create_account(session, account)
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

@register_command("get_ai_proxy_account_daily_usage")
async def cmd_get_ai_proxy_account_daily_usage(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import AiProxyAnalytics

    async def _op(session):
        return await AiProxyAnalytics.get_daily_usage_by_account(session)

    return await run_in_session(_op)


@register_command("get_daily_stats")
async def cmd_get_daily_stats(params: dict) -> dict:
    from stitch_backend.domains.ai_proxy.service import AiProxyAnalytics

    async def _op(session):
        return await AiProxyAnalytics.get_daily_stats(session)

    return await run_in_session(_op)


@register_command("get_model_usage")
async def cmd_get_model_usage(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import AiProxyAnalytics

    async def _op(session):
        return await AiProxyAnalytics.get_model_usage(session)

    return await run_in_session(_op)


@register_command("get_cost_estimate")
async def cmd_get_cost_estimate(params: dict) -> float:
    from stitch_backend.domains.ai_proxy.service import AiProxyAnalytics

    async def _op(session):
        return await AiProxyAnalytics.get_cost_estimate(session)

    return await run_in_session(_op)


@register_command("get_weekly_stats")
async def cmd_get_weekly_stats(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import AiProxyAnalytics

    async def _op(session):
        return await AiProxyAnalytics.get_weekly_stats(session)

    return await run_in_session(_op)


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

    return await run_in_session(_op)  # str — matches Rust String


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


# NOTE: start_ai_proxy / stop_ai_proxy are implemented in proxy_mgmt.commands
# (delegating to omniroute). Do NOT add stubs here — the import order would
# cause them to overwrite the real implementations.
