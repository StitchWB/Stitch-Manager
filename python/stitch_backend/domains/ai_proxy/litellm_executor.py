from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import time
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from starlette.responses import Response

from stitch_backend.domains.ai_proxy.adaptive_router import get_adaptive_router
from stitch_backend.domains.ai_proxy.cost_tracker import get_cost_tracker
from stitch_backend.domains.ai_proxy.key_metrics import get_metrics_tracker
from stitch_backend.domains.ai_proxy.litellm_gateway import (
    GatewayRequest,
    JsonObject,
    JsonValue,
    LiteLLMDeployment,
    _deployment_configs,
)
from stitch_backend.domains.ai_proxy.model_availability import get_model_tracker
from stitch_backend.domains.ai_proxy.rate_limiter import get_rate_limiter
from stitch_backend.domains.background_manager.schemas import BackgroundManagerConfig

logger = logging.getLogger(__name__)


class CompletionRouter(Protocol):
    async def acompletion(
        self,
        model: str,
        messages: list[dict[str, JsonValue]],
        stream: bool = False,
        **kwargs: JsonValue,
    ) -> JsonObject | BaseModel: ...

    async def aanthropic_messages(
        self,
        model: str,
        messages: list[dict[str, JsonValue]],
        stream: bool = False,
        **kwargs: JsonValue,
    ) -> JsonObject | BaseModel: ...

    async def aresponses(
        self,
        model: str,
        input: JsonValue,
        stream: bool = False,
        **kwargs: JsonValue,
    ) -> JsonObject | BaseModel: ...


KeyLoader = Callable[[], Awaitable[dict[str, list[dict[str, JsonValue]]]]]
ConfigLoader = Callable[[], Awaitable[BackgroundManagerConfig]]
RouterFactory = Callable[[list[LiteLLMDeployment]], CompletionRouter]


class LiteLLMExecutor:
    """Owns the in-process LiteLLM Router.

    Router handles per-deployment routing, cooldown, and fallback automatically.
    """

    def __init__(
        self,
        load_keys: KeyLoader,
        build_router: RouterFactory,
        load_config: ConfigLoader | None = None,
    ) -> None:
        self._load_keys = load_keys
        self._build_router = build_router
        self._load_config = load_config or _default_config
        self._router: CompletionRouter | None = None
        self._configuration_id: str | None = None
        self._providers: tuple[str, ...] = ()
        self._router_lock = asyncio.Lock()

    async def chat(self, payload: GatewayRequest) -> JsonObject | Response:
        config = await self._load_config()
        routed_model = _routed_model(payload, config)
        router = await self._current_router(config)
        
        # Extract provider from model name (e.g., "openai/gpt-4" -> "openai")
        provider = routed_model.split("/", 1)[0] if "/" in routed_model else "unknown"
        
        # Track metrics
        metrics_tracker = get_metrics_tracker()
        rate_limiter = get_rate_limiter()
        cost_tracker = get_cost_tracker()
        
        # Check rate limit
        if not await rate_limiter.can_use(provider):
            logger.warning("Rate limit exceeded for provider %s", provider)
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        
        start_time = time.time()
        try:
            response = await router.acompletion(
                model=routed_model,
                messages=_required_messages(payload),
                stream=payload.stream,
            )
            
            latency = time.time() - start_time
            
            # Record rate limit usage
            await rate_limiter.record(provider)
            
            # Extract tokens from response (if available)
            input_tokens = 0
            output_tokens = 0
            if not payload.stream and hasattr(response, "usage"):
                usage = response.usage
                input_tokens = getattr(usage, "prompt_tokens", 0)
                output_tokens = getattr(usage, "completion_tokens", 0)
            
            # Record success metrics
            await metrics_tracker.record_success(
                provider=provider,
                model=routed_model,
                latency=latency,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            
            # Record cost
            await cost_tracker.record_usage(
                key_id=provider,
                model=routed_model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            
            logger.info(
                "✅ %s | latency=%.2fs | tokens=%d/%d",
                routed_model, latency, input_tokens, output_tokens
            )
            
            if payload.stream:
                result, _ = await self._stream_response(response)
            else:
                result = _json_object(response)
            return result
            
        except Exception as e:
            latency = time.time() - start_time
            error_str = str(e).lower()
            
            # Check if this is a "model not found" error
            model_tracker = get_model_tracker()
            if "model" in error_str and ("not found" in error_str or "does not exist" in error_str):
                # Extract the actual model name (without provider prefix)
                actual_model = routed_model.split("/", 1)[1] if "/" in routed_model else routed_model
                await model_tracker.mark_model_unavailable(provider, actual_model)
                logger.warning(
                    "🚫 Model %s not available for provider %s, marked as unavailable",
                    actual_model, provider
                )
            
            await metrics_tracker.record_error(
                provider=provider,
                model=routed_model,
                latency=latency,
                error=str(e),
            )
            logger.error("❌ %s | latency=%.2fs | error=%s", routed_model, latency, e)
            raise

    async def messages(self, payload: GatewayRequest) -> JsonObject | Response:
        config = await self._load_config()
        routed_model = _routed_model(payload, config)
        router = await self._current_router(config)
        model = routed_model.split("/", 1)[1] if "/" in routed_model else routed_model
        
        # Extract provider from model name
        provider = routed_model.split("/", 1)[0] if "/" in routed_model else "unknown"
        
        # Track metrics
        metrics_tracker = get_metrics_tracker()
        rate_limiter = get_rate_limiter()
        cost_tracker = get_cost_tracker()
        
        # Check rate limit
        if not await rate_limiter.can_use(provider):
            logger.warning("Rate limit exceeded for provider %s", provider)
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        
        start_time = time.time()
        try:
            response = await router.aanthropic_messages(
                model=model,
                messages=_required_messages(payload),
                stream=payload.stream,
            )
            
            latency = time.time() - start_time
            
            # Record rate limit usage
            await rate_limiter.record(provider)
            
            # Extract tokens from response (if available)
            input_tokens = 0
            output_tokens = 0
            if not payload.stream and hasattr(response, "usage"):
                usage = response.usage
                input_tokens = getattr(usage, "input_tokens", 0)
                output_tokens = getattr(usage, "output_tokens", 0)
            
            # Record success metrics
            await metrics_tracker.record_success(
                provider=provider,
                model=routed_model,
                latency=latency,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            
            # Record cost
            await cost_tracker.record_usage(
                key_id=provider,
                model=routed_model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            
            logger.info(
                "✅ %s | latency=%.2fs | tokens=%d/%d",
                routed_model, latency, input_tokens, output_tokens
            )
            
            if payload.stream:
                result, _ = await self._stream_anthropic_response(response)
            else:
                result = _json_object(response)
            return result
            
        except Exception as e:
            latency = time.time() - start_time
            error_str = str(e).lower()
            
            # Check if this is a "model not found" error
            model_tracker = get_model_tracker()
            if "model" in error_str and ("not found" in error_str or "does not exist" in error_str):
                # Extract the actual model name (without provider prefix)
                actual_model = routed_model.split("/", 1)[1] if "/" in routed_model else routed_model
                await model_tracker.mark_model_unavailable(provider, actual_model)
                logger.warning(
                    "🚫 Model %s not available for provider %s, marked as unavailable",
                    actual_model, provider
                )
            
            await metrics_tracker.record_error(
                provider=provider,
                model=routed_model,
                latency=latency,
                error=str(e),
            )
            logger.error("❌ %s | latency=%.2fs | error=%s", routed_model, latency, e)
            raise

    async def responses(self, payload: GatewayRequest) -> JsonObject | Response:
        config = await self._load_config()
        routed_model = _routed_model(payload, config)
        router = await self._current_router(config)
        
        # Extract provider from model name
        provider = routed_model.split("/", 1)[0] if "/" in routed_model else "unknown"
        
        # Track metrics
        metrics_tracker = get_metrics_tracker()
        rate_limiter = get_rate_limiter()
        cost_tracker = get_cost_tracker()
        
        # Check rate limit
        if not await rate_limiter.can_use(provider):
            logger.warning("Rate limit exceeded for provider %s", provider)
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        
        start_time = time.time()
        try:
            response = await router.aresponses(
                model=routed_model,
                input=payload.input,
                stream=payload.stream,
            )
            
            latency = time.time() - start_time
            
            # Record rate limit usage
            await rate_limiter.record(provider)
            
            # Extract tokens from response (if available)
            input_tokens = 0
            output_tokens = 0
            if not payload.stream and hasattr(response, "usage"):
                usage = response.usage
                input_tokens = getattr(usage, "prompt_tokens", 0)
                output_tokens = getattr(usage, "completion_tokens", 0)
            
            # Record success metrics
            await metrics_tracker.record_success(
                provider=provider,
                model=routed_model,
                latency=latency,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            
            # Record cost
            await cost_tracker.record_usage(
                key_id=provider,
                model=routed_model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            
            logger.info(
                "✅ %s | latency=%.2fs | tokens=%d/%d",
                routed_model, latency, input_tokens, output_tokens
            )
            
            if payload.stream:
                result, _ = await self._stream_response(response)
            else:
                result = _json_object(response)
            return result
            
        except Exception as e:
            latency = time.time() - start_time
            error_str = str(e).lower()
            
            # Check if this is a "model not found" error
            model_tracker = get_model_tracker()
            if "model" in error_str and ("not found" in error_str or "does not exist" in error_str):
                # Extract the actual model name (without provider prefix)
                actual_model = routed_model.split("/", 1)[1] if "/" in routed_model else routed_model
                await model_tracker.mark_model_unavailable(provider, actual_model)
                logger.warning(
                    "🚫 Model %s not available for provider %s, marked as unavailable",
                    actual_model, provider
                )
            
            await metrics_tracker.record_error(
                provider=provider,
                model=routed_model,
                latency=latency,
                error=str(e),
            )
            logger.error("❌ %s | latency=%.2fs | error=%s", routed_model, latency, e)
            raise

    async def models(self) -> JsonObject:
        config = await self._load_config()
        await self._current_router(config)
        return {
            "object": "list",
            "data": [
                {"id": f"{provider}/*", "object": "model", "owned_by": provider}
                for provider in self._providers
            ],
        }

    async def _current_router(
        self, config: BackgroundManagerConfig
    ) -> CompletionRouter:
        provider_keys = await self._load_keys()
        configuration_id = _safe_configuration_id(provider_keys, config)
        async with self._router_lock:
            if self._router is None or configuration_id != self._configuration_id:
                deployment_source = {
                    provider: list(keys) for provider, keys in provider_keys.items()
                }
                deployments = _deployment_configs(deployment_source)
                if not deployments:
                    raise LookupError("No provider keys configured")
                self._router = self._build_router(deployments)
                self._configuration_id = configuration_id
                self._providers = tuple(
                    sorted(
                        {
                            deployment["model_name"].split("/", 1)[0]
                            for deployment in deployments
                        }
                    )
                )
        return self._router

    async def _stream_response(
        self, response: Any
    ) -> tuple[StreamingResponse, int | None]:
        chunks: list[str] = []
        actual_tokens: int | None = None
        async for chunk in response:
            value = chunk.model_dump(mode="json", exclude_none=True)
            chunks.append(f"data: {json.dumps(value, separators=(',', ':'))}\n\n")
            actual_tokens = _usage_tokens(value) or actual_tokens
        chunks.append("data: [DONE]\n\n")

        async def body():
            yield "".join(chunks).encode("utf-8")

        return StreamingResponse(body(), media_type="text/event-stream"), actual_tokens

    async def _stream_anthropic_response(
        self, response: Any
    ) -> tuple[StreamingResponse, int | None]:
        chunks: list[str] = []
        input_tokens = 0
        output_tokens = 0
        found_usage = False
        async for chunk in response:
            value = chunk.model_dump(mode="json", exclude_none=True)
            chunks.append(f"data: {json.dumps(value, separators=(',', ':'))}\n\n")
            usage = value.get("usage")
            if isinstance(usage, dict):
                found_usage = True
                input_tokens = max(input_tokens, _integer(usage.get("input_tokens")))
                output_tokens = max(output_tokens, _integer(usage.get("output_tokens")))

        async def body():
            yield "".join(chunks).encode("utf-8")

        actual_tokens = input_tokens + output_tokens if found_usage else None
        return StreamingResponse(body(), media_type="text/event-stream"), actual_tokens


def _is_safe_transport_failure(exc: BaseException) -> bool:
    safe_names = {
        "ConnectError",
        "ConnectTimeout",
        "InvalidURL",
        "ProxyError",
        "UnsupportedProtocol",
    }
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        if type(current).__name__ in safe_names:
            return True
        seen.add(id(current))
        current = current.__cause__ or current.__context__
    return False


async def _default_config() -> BackgroundManagerConfig:
    return BackgroundManagerConfig.model_validate({})


def _safe_configuration_id(
    provider_keys: dict[str, list[dict[str, JsonValue]]],
    config: BackgroundManagerConfig | None = None,
) -> str:
    safe: list[dict[str, object]] = [
        {
            "provider": provider,
            "key_id": hashlib.sha256(str(key.get("apiKey", "")).encode()).hexdigest(),
            "base_url": key.get("baseUrl"),
            "custom_provider": key if provider == "__custom_providers__" else None,
        }
        for provider, keys in sorted(provider_keys.items())
        for key in keys
    ]
    if config is not None:
        safe.append(
            {
                "auto_switch_enabled": config.auto_switch_enabled,
                "rotation_strategy": config.rotation_strategy,
                "provider_priority": config.provider_priority,
            }
        )
    return hashlib.sha256(json.dumps(safe, sort_keys=True).encode()).hexdigest()


def _routed_model(
    payload: GatewayRequest, config: BackgroundManagerConfig | None = None
) -> str:
    if not payload.model:
        raise HTTPException(
            status_code=422, detail={"error": {"message": "model is required"}}
        )
    if "/" in payload.model:
        return payload.model
    provider = payload.provider
    if (
        provider is None
        and config is not None
        and config.auto_switch_enabled
        and config.rotation_strategy == "priority"
        and config.provider_priority
    ):
        provider = config.provider_priority[0]
    return f"{(provider or 'openai').lower()}/{payload.model}"


def _estimate_request_tokens(payload: GatewayRequest) -> int:
    data = payload.sdk_payload()
    serialized = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    input_tokens = max(1, math.ceil(len(serialized.encode("utf-8")) / 3))
    output_tokens = 0
    for key in ("max_tokens", "max_completion_tokens", "max_output_tokens"):
        value = data.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            output_tokens = max(output_tokens, value)
    return input_tokens + (output_tokens or 1_024)


def _usage_tokens(response: JsonObject) -> int | None:
    usage = response.get("usage")
    if not isinstance(usage, dict):
        return None
    for key in ("total_tokens", "totalTokens"):
        total = _integer(usage.get(key))
        if total > 0:
            return total
    input_tokens = max(
        _integer(usage.get("input_tokens")),
        _integer(usage.get("prompt_tokens")),
    )
    output_tokens = max(
        _integer(usage.get("output_tokens")),
        _integer(usage.get("completion_tokens")),
    )
    total = input_tokens + output_tokens
    return total if total > 0 else None


def _integer(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _required_messages(payload: GatewayRequest) -> list[dict[str, JsonValue]]:
    if payload.messages is None:
        raise HTTPException(
            status_code=422, detail={"error": {"message": "messages are required"}}
        )
    return payload.messages


def _json_object(response: JsonObject | BaseModel) -> JsonObject:
    if isinstance(response, BaseModel):
        return response.model_dump(mode="json")
    return response
