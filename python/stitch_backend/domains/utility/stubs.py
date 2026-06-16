"""Stub command handlers for Priority 1 commands not yet fully ported.

These return safe defaults to prevent frontend 404 errors while real
implementations are being built.  Replace each stub with a real handler
as part of incremental porting.
"""

from __future__ import annotations

import logging

from stitch_backend.core.command_registry import register_command

logger = logging.getLogger(__name__)


# ═════════════════════════════════════════════════════════════════════════════
# Active accounts (accounts store)
# ═════════════════════════════════════════════════════════════════════════════

@register_command("get_active_accounts")
async def stub_get_active_accounts(params: dict) -> dict:
    """Return empty mapping — no active accounts set yet."""
    return {}


@register_command("set_active_account")
async def stub_set_active_account(params: dict) -> dict:
    """Acknowledge set_active_account without persisting (stub)."""
    provider = params.get("provider", "")
    account_id = params.get("accountId")
    logger.debug("stub set_active_account: provider=%s accountId=%s", provider, account_id)
    return {"success": True, "provider": provider, "accountId": account_id}


# ═════════════════════════════════════════════════════════════════════════════
# Registration status / jobs (UnifiedActivityFeed, ProviderFleetGrid)
# ═════════════════════════════════════════════════════════════════════════════

@register_command("get_registration_status")
async def stub_get_registration_status(params: dict) -> dict:
    """Return idle registration status."""
    return {
        "isRunning": False,
        "success": None,
        "status": None,
        "provider": None,
        "email": None,
        "step": None,
        "progress": None,
        "error": None,
        "startedAt": None,
        "completedAt": None,
    }


@register_command("get_registration_jobs")
async def stub_get_registration_jobs(params: dict) -> list:
    """Return empty job list."""
    return []


@register_command("get_registration_job")
async def stub_get_registration_job(params: dict) -> dict:
    """Return empty job."""
    job_id = params.get("jobId", "")
    return {
        "id": job_id,
        "status": "unknown",
        "provider": "",
        "email": "",
        "progress": 0,
        "error": None,
        "startedAt": None,
        "completedAt": None,
    }


@register_command("clear_registration_jobs")
async def stub_clear_registration_jobs(params: dict) -> None:
    """No-op clear."""
    return None


# ═════════════════════════════════════════════════════════════════════════════
# Background manager (SystemStatusStrip)
# ═════════════════════════════════════════════════════════════════════════════

@register_command("get_background_manager_config")
async def stub_get_bg_config(params: dict) -> dict:
    """Return disabled background manager config."""
    return {
        "autoRegisterEnabled": False,
        "registerIntervalMinutes": 60,
        "minAccountsThreshold": 2,
        "autoSwitchEnabled": False,
        "switchOnZeroCredits": False,
        "checkCreditsIntervalSeconds": 300,
        "autoRefreshQuotaEnabled": False,
        "refreshQuotaIntervalSeconds": 600,
        "refreshQuotaMaxErrors": 3,
    }


@register_command("update_background_manager_config")
async def stub_update_bg_config(params: dict) -> None:
    """No-op update."""
    return None


# ═════════════════════════════════════════════════════════════════════════════
# Observability (obs_ingest / obs_recent / obs_timeline)
# ═════════════════════════════════════════════════════════════════════════════

@register_command("obs_ingest")
async def stub_obs_ingest(params: dict) -> dict:
    """Accept event without storing."""
    return {"ok": True}


@register_command("obs_recent")
async def stub_obs_recent(params: dict) -> list:
    """Return empty recent events."""
    return []


@register_command("obs_timeline")
async def stub_obs_timeline(params: dict) -> list:
    """Return empty timeline."""
    return []


# ═════════════════════════════════════════════════════════════════════════════
# Proxy config / settings (useProxyConfig, aiProxy)
# ═════════════════════════════════════════════════════════════════════════════

@register_command("get_proxy_config")
async def stub_get_proxy_config(params: dict) -> dict:
    """Return disabled proxy config."""
    return {"enabled": False, "proxyType": "http", "proxies": []}


@register_command("get_proxy_settings")
async def stub_get_proxy_settings(params: dict) -> dict:
    """Return default proxy settings."""
    return {
        "appMode": "disabled",
        "proxyPort": 0,
        "autoStart": False,
        "routingStrategy": "round_robin",
        "managementKey": "",
    }


@register_command("save_proxy_config")
async def stub_save_proxy_config(params: dict) -> None:
    """No-op save."""
    return None


@register_command("update_proxy_settings")
async def stub_update_proxy_settings(params: dict) -> None:
    """No-op update."""
    return None


@register_command("get_request_history")
async def stub_get_request_history(params: dict) -> dict:
    """Return empty history."""
    return {"items": [], "total": 0}


@register_command("clear_request_history")
async def stub_clear_request_history(params: dict) -> None:
    """No-op clear."""
    return None


@register_command("get_proxy_debug_logs")
async def stub_get_proxy_debug_logs(params: dict) -> list:
    """Return empty debug logs."""
    return []


@register_command("clear_proxy_debug_logs")
async def stub_clear_proxy_debug_logs(params: dict) -> int:
    """Return 0 deleted."""
    return 0


# ═════════════════════════════════════════════════════════════════════════════
# Logs (logs store)
# ═════════════════════════════════════════════════════════════════════════════

@register_command("get_logs")
async def stub_get_logs(params: dict) -> dict:
    """Return empty log result."""
    return {"logs": [], "total": 0, "hasMore": False}


@register_command("get_log_stats")
async def stub_get_log_stats(params: dict) -> dict:
    """Return zero log stats."""
    return {"total": 0, "byLevel": {}, "bySource": {}}


@register_command("clear_app_logs")
async def stub_clear_app_logs(params: dict) -> int:
    """Return 0 deleted."""
    return 0


@register_command("export_app_logs")
async def stub_export_app_logs(params: dict) -> str:
    """Return empty export."""
    return ""


@register_command("add_app_log")
async def stub_add_app_log(params: dict) -> dict:
    """Accept log without storing."""
    return {"ok": True}


@register_command("add_log")
async def stub_add_log(params: dict) -> dict:
    """Accept log without storing."""
    return {"ok": True}


# ═════════════════════════════════════════════════════════════════════════════
# Misc stubs for commonly-called commands
# ═════════════════════════════════════════════════════════════════════════════

@register_command("get_ide_paths")
async def stub_get_ide_paths(params: dict) -> dict:
    """Return empty IDE paths."""
    return {}


@register_command("get_status")
async def stub_get_status(params: dict) -> dict:
    """Return generic status."""
    return {"backend": "python", "status": "running"}


@register_command("get_pool_status")
async def stub_get_pool_status(params: dict) -> dict:
    """Return empty pool."""
    return {"accounts": [], "total": 0, "active": 0}


@register_command("refresh_pool")
async def stub_refresh_pool(params: dict) -> dict:
    """No-op refresh."""
    return {"ok": True}


@register_command("reload_pool")
async def stub_reload_pool(params: dict) -> dict:
    """No-op reload."""
    return {"ok": True}
