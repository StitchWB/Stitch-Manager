from __future__ import annotations

import hmac
from collections.abc import Callable
from typing import Protocol, TypedDict

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.responses import Response

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

    async def responses(self, payload: GatewayRequest) -> JsonObject: ...

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
}


def _deployment_configs(
    provider_keys: dict[str, list[dict[str, JsonValue]]],
) -> list[LiteLLMDeployment]:
    deployments: list[LiteLLMDeployment] = []
    for provider, keys in provider_keys.items():
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
    ) -> JsonObject | JSONResponse:
        _require_auth(authorization, local_api_key)
        unsupported = _unsupported_adapter_response(payload)
        if unsupported is not None:
            return unsupported
        return await executor_factory().chat(payload)

    @router.post("/messages", response_model=None)
    async def messages(
        payload: GatewayRequest,
        authorization: str | None = Header(default=None),
    ) -> JsonObject | JSONResponse:
        _require_auth(authorization, local_api_key)
        unsupported = _unsupported_adapter_response(payload)
        if unsupported is not None:
            return unsupported
        return await executor_factory().messages(payload)

    @router.post("/responses", response_model=None)
    async def responses(
        payload: GatewayRequest,
        authorization: str | None = Header(default=None),
    ) -> JsonObject | JSONResponse:
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

    from stitch_backend.database import get_db
    from stitch_backend.domains.ai_proxy.litellm_executor import (
        CompletionRouter,
        LiteLLMExecutor,
    )
    from stitch_backend.domains.api_keys.service import ApiKeysService

    async def load_keys() -> dict[str, list[dict[str, JsonValue]]]:
        async with get_db() as session:
            service = ApiKeysService(session)
            providers = await service.list_providers()
            return {provider: await service.get_keys(provider) for provider in providers}

    def build_router(deployments: list[LiteLLMDeployment]) -> CompletionRouter:
        from litellm import Router

        return Router(
            model_list=deployments,
            num_retries=2,
            max_fallbacks=max(1, len(deployments) - 1),
            cooldown_time=60,
            allowed_fails=1,
            routing_strategy="simple-shuffle",
            enable_weighted_failover=True,
        )

    from stitch_backend.domains.ai_proxy.holone_stream import SecurityMode

    mode = SecurityMode(getattr(settings, "holone_mode", "block"))
    executor = LiteLLMExecutor(load_keys, build_router, security_mode=mode)

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
