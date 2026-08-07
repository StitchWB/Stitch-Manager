"""Key Health command handlers — 4 API commands.

get_key_health         — return all or provider-specific health records
test_provider_keys     — trigger manual key test for a provider or all providers
get_key_models         — return discovered models for a key
update_key_health_settings — update worker interval and other settings
"""

from __future__ import annotations

import json
import logging
from typing import Any

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.key_health.schemas import (
    TestProviderKeysRequest,
    UpdateKeyHealthSettingsRequest,
)

logger = logging.getLogger(__name__)


# ── Settings helpers ────────────────────────────────────────────────────────────

_KEY_HEALTH_SETTINGS_KEY = "key_health_settings"


async def _load_settings() -> dict[str, Any]:
    """Load persisted key health settings from the settings table."""
    async def _op(session):
        from sqlalchemy import text
        result = await session.execute(
            text("SELECT value FROM settings WHERE key = :k"),
            {"k": _KEY_HEALTH_SETTINGS_KEY},
        )
        row = result.first()
        if row and row[0]:
            try:
                return json.loads(row[0])
            except (json.JSONDecodeError, TypeError):
                pass
        return {"intervalSeconds": 300, "enabled": True}
    return await run_in_session(_op)


async def _save_settings(settings: dict[str, Any]) -> None:
    """Persist key health settings to the settings table."""
    async def _op(session):
        from sqlalchemy import text
        await session.execute(
            text(
                "INSERT INTO settings (key, value) VALUES (:k, :v) "
                "ON CONFLICT(key) DO UPDATE SET value = :v"
            ),
            {"k": _KEY_HEALTH_SETTINGS_KEY, "v": json.dumps(settings)},
        )
    await run_in_session(_op)


# ── Commands ────────────────────────────────────────────────────────────────────


@register_command("get_key_health", readonly=True)
async def cmd_get_key_health(params: dict) -> list[dict[str, Any]]:
    """Return all key health records, optionally filtered by provider.

    Params:
        providerId (str, optional): Filter by provider identifier.
    """
    from stitch_backend.domains.key_health.service import KeyHealthService

    provider_id = params.get("providerId") or params.get("provider_id")

    async def _op(session):
        svc = KeyHealthService(session)
        if provider_id:
            records = await svc.get_provider_health(provider_id)
        else:
            records = await svc.get_all_health()
        return [KeyHealthService.to_dict(r) for r in records]

    return await run_in_read_session(_op)


@register_command("test_provider_keys")
async def cmd_test_provider_keys(params: dict) -> dict[str, Any]:
    """Trigger a manual key test for a specific provider or all providers.

    Params:
        providerId (str, optional): Test only this provider's keys.

    Returns:
        {"success": True, "message": "..."}
    """
    from stitch_backend.domains.key_health.worker import KeyHealthWorker

    req = TestProviderKeysRequest.model_validate(params)
    provider_id = req.provider_id

    try:
        if provider_id:
            # Test only keys for one provider
            await _test_single_provider(provider_id)
        else:
            # Test all keys
            await KeyHealthWorker.run_now()
        return {
            "success": True,
            "message": (
                f"Key health test started for {provider_id or 'all providers'}"
            ),
        }
    except Exception as exc:
        logger.exception("test_provider_keys failed")
        return {"success": False, "error": str(exc)}


async def _test_single_provider(provider_id: str) -> None:
    """Run a health check for a single provider's keys."""
    import asyncio
    import time

    import httpx

    from stitch_backend.database import run_in_session
    from stitch_backend.domains.key_health.service import KeyHealthService, hash_key

    # Determine if this is a built-in or custom provider
    builtin = {"openai", "gemini", "anthropic", "antigravity", "fireworks", "dashscope"}

    if provider_id.startswith("custom_"):
        custom_id = provider_id[len("custom_"):]
        async def _op(session):
            from stitch_backend.domains.api_keys.service import ApiKeysService
            svc = ApiKeysService(session)
            db_key = f"custom_{custom_id}_api_keys"
            return await svc.get_keys_by_db_key(db_key)
        raw_keys = await run_in_session(_op)
    elif provider_id in builtin:
        async def _op(session):
            from stitch_backend.domains.api_keys.service import ApiKeysService
            svc = ApiKeysService(session)
            return await svc.get_keys(provider_id)
        raw_keys = await run_in_session(_op)
    else:
        raise ValueError(f"Unknown provider: {provider_id}")

    if not raw_keys:
        return

    # Default base URL mapping
    default_urls: dict[str, str] = {
        "openai": "https://api.openai.com",
        "antigravity": "https://api.openai.com",
        "fireworks": "https://api.fireworks.ai/inference",
        "dashscope": "https://dashscope.aliyuncs.com/compatible-mode",
        "gemini": "https://generativelanguage.googleapis.com/v1beta",
        "anthropic": "https://api.anthropic.com",
    }

    semaphore = asyncio.Semaphore(10)

    async def test_one(k: dict[str, Any]) -> None:
        api_key = k.get("apiKey") or k.get("api_key")
        if not api_key:
            return
        base_url = k.get("baseUrl") or k.get("base_url")
        if not base_url:
            base_url = default_urls.get(provider_id)
        if not base_url:
            return

        kh = hash_key(provider_id, api_key)
        test_url = f"{base_url.rstrip('/')}/v1/models"
        start = time.monotonic()
        success = False
        models = None
        error_msg = None
        http_status: int | None = None

        try:
            headers = {"Authorization": f"Bearer {api_key}"}
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(test_url, headers=headers)
                http_status = resp.status_code
                if resp.status_code == 200:
                    data = resp.json()
                    models = [
                        item.get("id", "") for item in data.get("data", [])
                    ]
                    success = True
                else:
                    error_msg = f"HTTP {resp.status_code}"
        except httpx.TimeoutException:
            error_msg = "Timeout"
        except httpx.ConnectError:
            error_msg = "Connection failed"
        except Exception as exc:
            error_msg = str(exc)[:200]

        latency_ms = (time.monotonic() - start) * 1000

        async def _persist(session):
            svc = KeyHealthService(session)
            await svc.upsert_health(
                provider_id=provider_id,
                key_hash=kh,
                status="healthy" if success else "unknown",
                models_available=models,
            )
            await svc.record_test_result(
                key_hash=kh,
                success=success,
                latency_ms=latency_ms,
                models_available=models,
                error=error_msg,
                http_status=http_status,
            )

        await run_in_session(_persist)

    async with semaphore:
        await asyncio.gather(
            *(test_one(k) for k in raw_keys), return_exceptions=True,
        )


@register_command("get_key_models", readonly=True)
async def cmd_get_key_models(params: dict) -> dict[str, Any]:
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

    async def _op(session):
        svc = KeyHealthService(session)
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

    return await run_in_read_session(_op)


@register_command("update_key_health_settings")
async def cmd_update_key_health_settings(params: dict) -> dict[str, Any]:
    """Update key health worker settings.

    Params:
        intervalSeconds (int, optional): Worker check interval (default 300).
        enabled (bool, optional): Whether the worker is enabled.

    Returns:
        {"success": True, "settings": {...}}
    """
    from stitch_backend.domains.key_health.worker import KeyHealthWorker

    req = UpdateKeyHealthSettingsRequest.model_validate(params)
    current = await _load_settings()

    if req.interval_seconds is not None:
        current["intervalSeconds"] = req.interval_seconds
    if req.enabled is not None:
        current["enabled"] = req.enabled

    await _save_settings(current)

    # Restart worker with new interval if running
    if current["enabled"]:
        await KeyHealthWorker.stop()
        await KeyHealthWorker.start(
            interval_seconds=current["intervalSeconds"],
        )

    return {"success": True, "settings": current}