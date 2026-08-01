"""KeyHealthWorker — periodic background task that tests all API keys.

Runs every ``interval_seconds`` (default 300s), fetches all known API keys
from providers and custom providers, tests each via adapter probe,
and persists results to the ``key_health`` table.

Flaky detection: a key is marked FLAKY if success_rate drops below 0.8.

Start/stop lifecycle:
    await KeyHealthWorker.start()
    await KeyHealthWorker.stop()
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from stitch_backend.database import run_in_session
from stitch_backend.domains.key_health.service import KeyHealthService, hash_key

logger = logging.getLogger(__name__)


class KeyHealthWorker:
    """Periodic key health checker."""

    _task: asyncio.Task[None] | None = None
    _interval_seconds: int = 300

    @classmethod
    async def start(
        cls, *, interval_seconds: int = 300,
    ) -> None:
        """Start the periodic health check loop."""
        if cls._task is not None:
            logger.warning("KeyHealthWorker already running")
            return
        cls._interval_seconds = interval_seconds
        cls._task = asyncio.create_task(cls._loop())
        logger.info(
            "KeyHealthWorker started — interval=%ds", interval_seconds,
        )

    @classmethod
    async def stop(cls) -> None:
        """Stop the periodic health check loop."""
        if cls._task is None:
            return
        cls._task.cancel()
        try:
            await cls._task
        except asyncio.CancelledError:
            pass
        cls._task = None
        logger.info("KeyHealthWorker stopped")

    @classmethod
    async def _loop(cls) -> None:
        """Main loop: sleep, then check all keys."""
        while True:
            try:
                await asyncio.sleep(cls._interval_seconds)
                await cls._check_all_keys()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("KeyHealthWorker loop error — will retry")

    # ── Core check logic ────────────────────────────────────────────────────────

    @classmethod
    async def _check_all_keys(cls) -> None:
        """Fetch all keys from all providers and test each one."""
        start = time.monotonic()
        keys_to_test: list[dict[str, Any]] = await cls._gather_all_keys()

        if not keys_to_test:
            logger.debug("KeyHealthWorker: no keys to test")
            return

        logger.info("KeyHealthWorker: testing %d keys", len(keys_to_test))

        # Test keys concurrently with a semaphore limit
        semaphore = asyncio.Semaphore(10)

        async def test_one(key_info: dict[str, Any]) -> None:
            async with semaphore:
                await cls._test_single_key(key_info)

        await asyncio.gather(
            *(test_one(k) for k in keys_to_test), return_exceptions=True,
        )

        elapsed = time.monotonic() - start
        logger.info(
            "KeyHealthWorker: check complete — %d keys in %.1fs",
            len(keys_to_test), elapsed,
        )

    @classmethod
    async def _gather_all_keys(cls) -> list[dict[str, Any]]:
        """Collect all known API keys from providers and custom providers."""
        keys: list[dict[str, Any]] = []

        # ── Built-in providers ──────────────────────────────────────────────
        builtin = ["openai", "gemini", "anthropic", "antigravity", "fireworks", "dashscope"]
        for provider in builtin:
            try:
                provider_keys = await cls._load_provider_keys(provider)
                for k in provider_keys:
                    api_key = k.get("apiKey") or k.get("api_key")
                    if not api_key:
                        continue
                    base_url = k.get("baseUrl") or k.get("base_url")
                    keys.append({
                        "provider_id": provider,
                        "api_key": api_key,
                        "base_url": base_url,
                    })
            except Exception:
                logger.debug(
                    "KeyHealthWorker: could not load keys for %s", provider,
                )

        # ── Custom providers ────────────────────────────────────────────────
        try:
            custom_keys = await cls._load_custom_provider_keys()
            keys.extend(custom_keys)
        except Exception:
            logger.debug("KeyHealthWorker: could not load custom provider keys")

        return keys

    @classmethod
    async def _load_provider_keys(
        cls, provider: str,
    ) -> list[dict[str, Any]]:
        """Load keys for a built-in provider."""
        async def _op(session):
            from stitch_backend.domains.api_keys.service import ApiKeysService
            svc = ApiKeysService(session)
            return await svc.get_keys(provider)
        return await run_in_session(_op)

    @classmethod
    async def _load_custom_provider_keys(cls) -> list[dict[str, Any]]:
        """Load keys from all custom providers."""
        async def _op(session):
            from stitch_backend.domains.api_keys.custom_providers import (
                get_custom_providers,
            )
            from stitch_backend.domains.api_keys.service import ApiKeysService

            providers = await get_custom_providers(session)
            svc = ApiKeysService(session)
            results: list[dict[str, Any]] = []
            for provider in providers:
                provider_id = provider.id
                provider_name = provider.name
                db_key = f"custom_{provider_id}_api_keys"
                try:
                    keys = await svc.get_keys_by_db_key(db_key)
                    for k in keys:
                        api_key = k.get("apiKey") or k.get("api_key")
                        if not api_key:
                            continue
                        base_url = k.get("baseUrl") or k.get("base_url")
                        results.append({
                            "provider_id": f"custom_{provider_id}",
                            "provider_name": provider_name,
                            "api_key": api_key,
                            "base_url": base_url,
                        })
                except Exception:
                    logger.debug(
                        "KeyHealthWorker: could not load custom keys for %s",
                        provider_id,
                    )
            return results
        return await run_in_session(_op)

    @classmethod
    async def _test_single_key(cls, key_info: dict[str, Any]) -> None:
        """Test one API key via the appropriate adapter and persist the result."""
        provider_id: str = key_info["provider_id"]
        api_key: str = key_info["api_key"]
        base_url: str | None = key_info.get("base_url")

        kh = hash_key(provider_id, api_key)

        # Determine base URL
        if base_url:
            test_url = base_url.rstrip("/")
        else:
            test_url = cls._default_base_url(provider_id)

        if not test_url:
            return

        # Map provider_id to adapter_type
        adapter_type = cls._adapter_type_for_provider(provider_id)

        start = time.monotonic()
        success = False
        models: list | None = None
        error_msg: str | None = None
        http_status: int | None = None

        try:
            from stitch_backend.domains.ai_gateway.adapters.base import get_adapter
            adapter = get_adapter(adapter_type)
            probe = await adapter.probe_credential(
                base_url=test_url,
                secret=api_key,
            )
            success = probe.success
            http_status = probe.http_status
            models = probe.models
            error_msg = probe.error
        except KeyError:
            # Unknown adapter type — fall back to legacy httpx
            try:
                url = f"{test_url}/v1/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(url, headers=headers)
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
        except Exception as exc:
            error_msg = str(exc)[:200]

        latency_ms = (time.monotonic() - start) * 1000

        # Persist result
        async def _op(session):
            svc = KeyHealthService(session)
            # Ensure record exists
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

        try:
            await run_in_session(_op)
        except Exception:
            logger.exception(
                "KeyHealthWorker: failed to persist result for %s/%s",
                provider_id, kh[:8],
            )

        if success:
            logger.debug(
                "KeyHealthWorker: OK  %s/%s (%d models, %.0fms)",
                provider_id, kh[:8], len(models or []), latency_ms,
            )
        else:
            logger.debug(
                "KeyHealthWorker: FAIL %s/%s (%s, %.0fms)",
                provider_id, kh[:8], error_msg, latency_ms,
            )

    @staticmethod
    def _default_base_url(provider_id: str) -> str | None:
        """Return the default base URL for a known provider."""
        # ponytail: simple mapping, add when more providers need custom base URLs
        mapping: dict[str, str] = {
            "openai": "https://api.openai.com",
            "antigravity": "https://api.openai.com",
            "fireworks": "https://api.fireworks.ai/inference",
            "dashscope": "https://dashscope.aliyuncs.com/compatible-mode",
            "gemini": "https://generativelanguage.googleapis.com/v1beta",
            "anthropic": "https://api.anthropic.com",
        }
        return mapping.get(provider_id)

    @staticmethod
    def _adapter_type_for_provider(provider_id: str) -> str:
        """Map provider_id to adapter_type for the ai_gateway adapter registry."""
        mapping: dict[str, str] = {
            "anthropic": "anthropic",
            "gemini": "gemini",
        }
        # Everything else (openai, fireworks, dashscope, custom, etc.) uses openai_compatible
        return mapping.get(provider_id, "openai_compatible")

    # ── Public API for manual triggering ────────────────────────────────────────

    @classmethod
    async def run_now(cls) -> None:
        """Trigger a health check immediately (non-blocking)."""
        asyncio.create_task(cls._check_all_keys())

    @classmethod
    def status(cls) -> dict[str, Any]:
        """Return current worker status."""
        return {
            "running": cls._task is not None and not cls._task.done(),
            "intervalSeconds": cls._interval_seconds,
        }