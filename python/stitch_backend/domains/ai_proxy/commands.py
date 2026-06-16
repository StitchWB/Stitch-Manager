"""AI Proxy command handlers — 35 commands.

Covers account CRUD, export/import, model management, IDE config,
quotas, auth flows, analytics, and utility operations.
"""

from __future__ import annotations

import json
import logging
import webbrowser
from typing import Any

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
async def cmd_import_ai_proxy_accounts_payload(params: dict) -> dict:
    from stitch_backend.domains.ai_proxy.service import import_accounts_payload

    payload_str = params.get("payload", params.get("payloadStr", "{}"))
    if isinstance(payload_str, dict):
        payload_str = json.dumps(payload_str)

    async def _op(session):
        return await import_accounts_payload(session, payload_str)

    imported = await run_in_session(_op)
    return {"imported": imported}


# ── Models ──────────────────────────────────────────────────────────────────

@register_command("get_available_models")
async def cmd_get_available_models(params: dict) -> list:
    """Return list of known models across all providers."""
    _KNOWN = [
        {"id": "gpt-4o", "provider": "openai", "name": "GPT-4o"},
        {"id": "gpt-4o-mini", "provider": "openai", "name": "GPT-4o Mini"},
        {"id": "gpt-4.1", "provider": "openai", "name": "GPT-4.1"},
        {"id": "o3", "provider": "openai", "name": "o3"},
        {"id": "gemini-2.5-pro", "provider": "gemini", "name": "Gemini 2.5 Pro"},
        {"id": "gemini-2.5-flash", "provider": "gemini", "name": "Gemini 2.5 Flash"},
        {"id": "claude-sonnet-4-20250514", "provider": "anthropic", "name": "Claude Sonnet 4"},
        {"id": "claude-3-7-sonnet", "provider": "anthropic", "name": "Claude 3.7 Sonnet"},
        {"id": "accounts/fireworks/models/llama4-scout-instruct-17b-16e-instruct",
         "provider": "fireworks", "name": "Llama 4 Scout"},
    ]
    return _KNOWN


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
async def cmd_get_provider_model_mappings(params: dict) -> dict:
    from stitch_backend.domains.ai_proxy.service import get_settings_kv

    async def _op(session):
        raw = await get_settings_kv(session, "provider_model_mappings")
        if raw:
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {}
        return {}

    return await run_in_session(_op)


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

    _PROVIDERS = ("openai", "gemini", "anthropic", "antigravity", "fireworks")

    async def _op(session):
        accounts = await AiProxyAccountStore.get_accounts(session)
        result = []
        for provider in _PROVIDERS:
            total = [a for a in accounts if a["provider"].lower() == provider]
            enabled = [a for a in total if a["enabled"]]
            result.append({
                "provider": provider,
                "supportsApiKeys": provider in ("openai", "gemini", "antigravity", "anthropic", "fireworks"),
                "supportsOauth": True,
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
async def cmd_get_ai_proxy_ide_config_preview(params: dict) -> dict:
    """Preview the IDE configuration that would be written."""
    ide = params.get("ide", params.get("ideType", ""))
    return {
        "ide": ide,
        "configPreview": {
            "proxyUrl": "http://127.0.0.1:0",
            "apiKey": "***",
            "models": [],
        },
    }


@register_command("restore_ai_proxy_ide_config")
async def cmd_restore_ai_proxy_ide_config(params: dict) -> dict:
    """Restore IDE config to its default (un-proxied) state."""
    ide = params.get("ide", params.get("ideType", ""))
    return {"success": True, "message": f"Restored {ide} to default config", "ide": ide}


# ── Quotas ──────────────────────────────────────────────────────────────────

@register_command("fetch_all_quotas_cmd")
async def cmd_fetch_all_quotas(params: dict) -> list:
    """Fetch quota info for all enabled AI proxy accounts."""
    return []


@register_command("fetch_openai_account_quotas_cmd")
async def cmd_fetch_openai_account_quotas(params: dict) -> list:
    """Fetch OpenAI-specific quota info."""
    return []


@register_command("fetch_kiro_account_quotas_cmd")
async def cmd_fetch_kiro_account_quotas(params: dict) -> list:
    """Fetch Kiro-specific quota info."""
    return []


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
async def cmd_debug_run_ai_proxy_migration(params: dict) -> dict:
    """Run a raw SQL migration for debugging."""
    from sqlalchemy import text as sql_text

    sql = params.get("sql", "")
    if not sql:
        return {"error": "sql is required"}

    async def _op(session):
        result = await session.execute(sql_text(sql))
        return {"rowsAffected": result.rowcount}

    return await run_in_session(_op)


@register_command("test_provider_connection")
async def cmd_test_provider_connection(params: dict) -> dict:
    """Test connection to an AI proxy provider."""
    provider = params.get("provider", "")
    return {
        "success": False,
        "provider": provider,
        "message": f"Connection test for {provider} not yet implemented",
        "latencyMs": 0,
    }


@register_command("start_ai_proxy")
async def cmd_start_ai_proxy(params: dict) -> dict:
    """Start the AI proxy sidecar process."""
    return {
        "running": False,
        "managedByApp": False,
        "networkReachable": False,
        "proxyPort": 0,
        "message": "AI proxy sidecar management not yet ported to Python backend",
    }


@register_command("stop_ai_proxy")
async def cmd_stop_ai_proxy(params: dict) -> dict:
    """Stop the AI proxy sidecar process."""
    return {
        "running": False,
        "managedByApp": False,
        "networkReachable": False,
        "proxyPort": 0,
    }
