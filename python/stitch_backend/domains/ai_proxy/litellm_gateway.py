from __future__ import annotations

import hmac
import logging
import time
from collections.abc import Callable
from typing import Any, Protocol, TypedDict, cast

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.responses import Response

from .adaptive_router import get_adaptive_router
from .cost_tracker import get_cost_tracker
from .key_metrics import get_metrics_tracker
from .rate_limiter import get_rate_limiter

logger = logging.getLogger(__name__)

JsonScalar = str | int | float | bool | None
JsonValue = JsonScalar | dict[str, JsonScalar] | list[JsonScalar | dict[str, JsonScalar]]
JsonObject = dict[str, JsonValue]


class GatewayRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="allow")

    model: str | None = None
    provider: str | None = None
    messages: list[dict[str, JsonValue]] | None = None
    input: JsonValue = None
    stream: bool = False
    tools: list[dict[str, JsonValue]] | None = None

    def sdk_payload(self) -> JsonObject:
        return self.model_dump(mode="json", exclude_none=True)


class NativeGatewayExecutor(Protocol):
    async def chat(self, payload: GatewayRequest) -> JsonObject | Response: ...

    async def messages(self, payload: GatewayRequest) -> JsonObject | Response: ...

    async def responses(self, payload: GatewayRequest) -> JsonObject | Response: ...

    async def models(self) -> JsonObject: ...


class GatewaySettings(Protocol):
    litellm_gateway_local_api_key: str | None


class StoredApiKey(BaseModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True)

    api_key: str
    base_url: str | None = None
    model_prefix: str | None = None


class LiteLLMParams(TypedDict, total=False):
    model: str
    api_key: str
    api_base: str


class LiteLLMDeployment(TypedDict):
    model_name: str
    litellm_params: LiteLLMParams


_UNSUPPORTED_ADAPTERS = frozenset({"kiro", "windsurf"})
_LITELLM_PROVIDER_MODELS = {
    "openai": "openai/*",
    "anthropic": "anthropic/*",
    "gemini": "gemini/*",
    "fireworks": "fireworks_ai/*",
    "antigravity": "openai/*",
    "dashscope": "openai/*",
}


def _deployment_configs(
    provider_keys: dict[str, list[dict[str, JsonValue]]],
) -> list[LiteLLMDeployment]:
    deployments: list[LiteLLMDeployment] = []

    # Extract custom providers metadata (stored under special key)
    custom_providers_meta = provider_keys.pop("__custom_providers__", [])

    # Built-in providers
    for provider, keys in provider_keys.items():
        if provider.startswith("custom_"):
            continue  # Skip custom provider keys in built-in loop
        model = _LITELLM_PROVIDER_MODELS.get(provider)
        if model is None:
            continue
        for stored in keys:
            api_key = stored.get("apiKey")
            if not isinstance(api_key, str) or not api_key.strip():
                continue
            params = LiteLLMParams(model=model, api_key=api_key)
            base_url = stored.get("baseUrl")
            if isinstance(base_url, str) and base_url.strip():
                params["api_base"] = base_url
            deployments.append(
                LiteLLMDeployment(
                    model_name=f"{provider}/*",
                    litellm_params=params,
                )
            )

    # Custom providers
    if isinstance(custom_providers_meta, list):
        for cp in custom_providers_meta:
            if not isinstance(cp, dict):
                continue
            cp_id = cp.get("id")
            cp_name = cp.get("name", "custom")
            cp_base_url = cp.get("base_url")
            cp_model = cp.get("litellm_model", "openai/*")
            if not isinstance(cp_id, str) or not isinstance(cp_base_url, str):
                continue
            cp_keys = provider_keys.get(f"custom_{cp_id}", [])
            for stored in cp_keys:
                api_key = stored.get("apiKey")
                if not isinstance(api_key, str) or not api_key.strip():
                    continue
                params = LiteLLMParams(
                    model=cp_model if isinstance(cp_model, str) else "openai/*",
                    api_key=api_key,
                    api_base=cp_base_url,
                )
                deployments.append(
                    LiteLLMDeployment(
                        model_name=f"{cp_name}/*",
                        litellm_params=params,
                    )
                )

    return deployments


def create_native_gateway_router(
    executor_factory: Callable[[], NativeGatewayExecutor],
    local_api_key: str,
) -> APIRouter:
    """Build Stitch's in-process OpenAI/Anthropic-compatible gateway routes."""
    router = APIRouter(prefix="/v1", tags=["Native AI Gateway"])

    @router.post("/chat/completions", response_model=None)
    async def chat_completions(
        payload: GatewayRequest,
        authorization: str | None = Header(default=None),
    ) -> JsonObject | Response:
        _require_auth(authorization, local_api_key)
        unsupported = _unsupported_adapter_response(payload)
        if unsupported is not None:
            return unsupported
        return await executor_factory().chat(payload)

    @router.post("/messages", response_model=None)
    async def messages(
        payload: GatewayRequest,
        authorization: str | None = Header(default=None),
    ) -> JsonObject | Response:
        _require_auth(authorization, local_api_key)
        unsupported = _unsupported_adapter_response(payload)
        if unsupported is not None:
            return unsupported
        return await executor_factory().messages(payload)

    @router.post("/responses", response_model=None)
    async def responses(
        payload: GatewayRequest,
        authorization: str | None = Header(default=None),
    ) -> JsonObject | Response:
        _require_auth(authorization, local_api_key)
        unsupported = _unsupported_adapter_response(payload)
        if unsupported is not None:
            return unsupported
        return await executor_factory().responses(payload)

    @router.get("/models")
    async def models(authorization: str | None = Header(default=None)) -> JsonObject:
        _require_auth(authorization, local_api_key)
        return await executor_factory().models()

    return router


def create_litellm_gateway_router(settings: GatewaySettings) -> APIRouter | None:
    """Return the enabled gateway router; credentials stay server-side."""
    if not settings.litellm_gateway_local_api_key:
        return None

    import asyncio
    import json
    import time

    from sqlalchemy import text

    from stitch_backend.database import get_db
    from stitch_backend.domains.ai_proxy.litellm_executor import (
        CompletionRouter,
        LiteLLMExecutor,
    )
    from stitch_backend.domains.api_keys.service import ApiKeysService
    from stitch_backend.domains.background_manager.schemas import (
        BackgroundManagerConfig,
        normalise_background_manager_config,
    )

    runtime_config = BackgroundManagerConfig.model_validate({})
    runtime_config_expires_at = 0.0
    runtime_config_lock = asyncio.Lock()

    async def load_keys() -> dict[str, list[dict[str, JsonValue]]]:
        async with get_db() as session:
            service = ApiKeysService(session)
            providers = await service.list_providers()
            keys = {provider: await service.get_keys(provider) for provider in providers}

            from stitch_backend.domains.api_keys.custom_providers import (
                custom_provider_db_key,
                get_custom_providers,
            )
            custom_providers = await get_custom_providers(session)
            keys["__custom_providers__"] = [cp.to_dict() for cp in custom_providers]
            for cp in custom_providers:
                cp_keys = await service.get_keys_by_db_key(custom_provider_db_key(cp.id))
                keys[f"custom_{cp.id}"] = cp_keys

            return keys

    async def load_config() -> BackgroundManagerConfig:
        nonlocal runtime_config, runtime_config_expires_at
        now = time.monotonic()
        if now < runtime_config_expires_at:
            return runtime_config

        async with runtime_config_lock:
            now = time.monotonic()
            if now < runtime_config_expires_at:
                return runtime_config
            async with get_db() as session:
                result = await session.execute(
                    text("SELECT value FROM settings WHERE key = 'background_manager_config'")
                )
                row = result.first()
            if not row or not row[0]:
                runtime_config = BackgroundManagerConfig.model_validate({})
            else:
                try:
                    value = json.loads(row[0])
                except (json.JSONDecodeError, TypeError):
                    value = None
                runtime_config = normalise_background_manager_config(value)
            runtime_config_expires_at = time.monotonic() + 1.0
            return runtime_config

    def build_router(deployments: list[LiteLLMDeployment]) -> CompletionRouter:
        from litellm import Router

        selected_strategy = (
            runtime_config.rotation_strategy
            if runtime_config.auto_switch_enabled
            else "random"
        )
        routing_strategy: Any = {
            "round-robin": "usage-based-routing",
            "random": "simple-shuffle",
            "least-used": "usage-based-routing-v2",
            "priority": "simple-shuffle",
        }[selected_strategy]
        router = Router(
            model_list=cast(list[dict[str, Any]], deployments),
            num_retries=2,
            max_fallbacks=max(1, len(deployments) - 1),
            cooldown_time=30,
            allowed_fails=2,
            routing_strategy=routing_strategy,
        )
        return cast(CompletionRouter, router)

    executor = LiteLLMExecutor(
        load_keys,
        build_router,
        load_config=load_config,
    )

    return create_native_gateway_router(
        lambda: executor,
        settings.litellm_gateway_local_api_key,
    )


def _require_auth(authorization: str | None, local_api_key: str) -> None:
    expected = f"Bearer {local_api_key}"
    if not hmac.compare_digest(authorization or "", expected):
        raise HTTPException(status_code=401, detail={"error": {"message": "Unauthorized"}})


def _unsupported_adapter_response(payload: GatewayRequest) -> JSONResponse | None:
    if payload.provider is not None and payload.provider.lower() in _UNSUPPORTED_ADAPTERS:
        return JSONResponse(
            status_code=501,
            content={
                "error": {
                    "code": "adapter_not_implemented",
                    "message": "Provider adapter is not implemented",
                }
            },
        )
    return None


def _required_model(payload: GatewayRequest) -> str:
    if not payload.model:
        raise HTTPException(status_code=422, detail={"error": {"message": "model is required"}})
    return payload.model


def _messages(payload: GatewayRequest) -> list[dict[str, JsonValue]]:
    if payload.messages is None:
        raise HTTPException(status_code=422, detail={"error": {"message": "messages are required"}})
    return payload.messages


def _json_object(response: JsonObject | BaseModel) -> JsonObject:
    if isinstance(response, BaseModel):
        value = response.model_dump(mode="json")
        return value
    if isinstance(response, dict):
        return response
    raise HTTPException(status_code=502, detail={"error": {"message": "Invalid provider response"}})
