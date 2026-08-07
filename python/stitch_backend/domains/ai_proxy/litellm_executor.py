from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import time
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any, Protocol

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import exc as sqlalchemy_exc

from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway import circuit_breaker
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error
from stitch_backend.domains.ai_gateway.routing_engine import GatewayRequest as AIGatewayRequest
from stitch_backend.domains.ai_gateway.routing_engine import RoutingEngine, RoutingError
from stitch_backend.domains.ai_proxy.compression.service import get_compression_service
from stitch_backend.domains.ai_proxy.cost_tracker import get_cost_tracker
from stitch_backend.domains.ai_proxy.holone_service import get_holone_service
from stitch_backend.domains.ai_proxy.key_metrics import get_metrics_tracker
from stitch_backend.domains.ai_proxy.litellm_gateway import (
    GatewayRequest,
    JsonObject,
    JsonValue,
    LiteLLMDeployment,
    _deployment_configs,
)
from stitch_backend.domains.ai_proxy.rate_limiter import get_rate_limiter
from stitch_backend.domains.background_manager.schemas import BackgroundManagerConfig

if TYPE_CHECKING:
    from starlette.responses import Response

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
    When AI Gateway routing engine is available (public models configured),
    uses it for capability-aware routing with fallback to LiteLLM Router.
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
        self._routing_engine = RoutingEngine()

    async def _try_ai_gateway_route(
        self, payload: GatewayRequest,
    ) -> list[Any] | None:
        """Attempt routing via AI Gateway engine. Returns list of routing candidates or None."""
        try:
            gw_request = AIGatewayRequest(
                model=payload.model,
                messages=payload.messages or [],
                stream=payload.stream,
                tools=payload.tools,
                response_format=payload.response_format,
            )

            async def _route(session):
                return await self._routing_engine.route(session, gw_request)

            routing_results = await run_in_session(_route)
            logger.info(
                "AI Gateway route: %s → %d candidate(s), first: %s/%s (credential=%s)",
                payload.model,
                len(routing_results),
                routing_results[0].endpoint.name,
                routing_results[0].upstream_model.upstream_model_id,
                routing_results[0].credential.id[:8],
            )
            return routing_results
        except RoutingError as e:
            logger.debug("AI Gateway route unavailable for %s: %s", payload.model, e)
            return None
        except Exception as e:
            # DB-level failures (connection, locked, etc.) are operator errors —
            # log at error so they surface above routine routing misses.
            if isinstance(e, sqlalchemy_exc.DBAPIError):
                logger.error("AI Gateway DB error for %s: %s", payload.model, e)
            else:
                logger.warning("AI Gateway route error for %s: %s", payload.model, e)
            return None

    async def _is_endpoint_available(self, endpoint_id: str) -> bool:
        """Re-check the circuit breaker for an endpoint before invoking.

        Routing checked availability once per candidate, but a failure on
        candidate N may have opened the circuit for an endpoint that candidate
        N+1 shares. Cheap: one row read + atomic CAS.
        """
        async def _check(session):
            return await circuit_breaker.is_endpoint_available(session, endpoint_id)
        return await run_in_session(_check)

    def _sync_pipeline_config(self, config: BackgroundManagerConfig) -> tuple:
        """Sync HoloNe and Compression middleware config. Returns (holone_service, compression_service)."""
        holone_service = get_holone_service()
        holone_service.config.enabled = config.holone_enabled
        holone_service.config.mode = config.holone_mode

        compression_service = get_compression_service()
        compression_service.config.enabled = config.compression_enabled
        compression_service.config.rtk_enabled = config.rtk_enabled
        compression_service.config.caveman_enabled = config.caveman_enabled
        compression_service.config.caveman_level = config.caveman_level
        compression_service.config.input_compression_enabled = config.input_compression_enabled
        compression_service.config.output_compression_enabled = config.output_compression_enabled
        compression_service.config.preserve_system_prompt = config.preserve_system_prompt
        compression_service.config.auto_trigger_threshold = config.auto_trigger_threshold

        return holone_service, compression_service

    async def chat(self, payload: GatewayRequest) -> JsonObject | Response:
        config = await self._load_config()

        # Try AI Gateway routing first
        routing_results = await self._try_ai_gateway_route(payload)
        if routing_results is not None:
            for routing_result in routing_results:
                if not await self._is_endpoint_available(routing_result.endpoint.id):
                    logger.debug(
                        "Skipping candidate on endpoint %s — circuit open",
                        routing_result.endpoint.id,
                    )
                    continue
                try:
                    return await self._invoke_via_gateway(payload, routing_result, config)
                except Exception as e:
                    logger.warning(
                        "AI Gateway invoke failed for %s (credential=%s): %s — trying next candidate",
                        payload.model, routing_result.credential.id[:8], e,
                    )

        # Fall back to LiteLLM Router
        routed_model = _routed_model(payload, config)
        router = await self._current_router(config)

        # Extract provider from model name (e.g., "openai/gpt-4" -> "openai")
        provider = routed_model.split("/", 1)[0] if "/" in routed_model else "unknown"

        # Track metrics
        metrics_tracker = get_metrics_tracker()
        rate_limiter = get_rate_limiter()
        cost_tracker = get_cost_tracker()

        holone_service, compression_service = self._sync_pipeline_config(config)

        # Check rate limit
        # NOTE: using provider as key_id — interim simplification pending per-credential routing
        if not await rate_limiter.can_use(provider, provider):
            logger.warning("Rate limit exceeded for provider %s", provider)
            raise HTTPException(status_code=429, detail="Rate limit exceeded")

        # HoloNe request inspection
        if holone_service.config.enabled:
            request_findings = holone_service.inspect_request(_required_messages(payload))
            if request_findings and holone_service.config.mode == "block":
                logger.warning("HoloNe blocked request: %s", [f.rule_id for f in request_findings])
                raise HTTPException(status_code=403, detail="Blocked by HoloNe")

        # Compression: compress input messages
        messages = _required_messages(payload)
        if compression_service.config.enabled:
            messages = compression_service.compress_input(messages)

        client_has_tools = bool(payload.tools or getattr(payload, "tool_choice", None))
        start_time = time.time()
        try:
            response = await router.acompletion(
                model=routed_model,
                messages=messages,
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
            # NOTE: using provider as key_id — interim simplification pending per-credential routing
            await metrics_tracker.record_success(
                key_id=provider,
                provider=provider,
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
                result, _ = await self._stream_response(response, client_has_tools=client_has_tools)
            else:
                result = _json_object(response)
                if holone_service.config.enabled:
                    result, findings, blocked = holone_service.inspect_response_openai(
                        result, client_has_tools=client_has_tools
                    )
                    if findings:
                        logger.info("HoloNe findings: %s (blocked=%s)", [f.rule_id for f in findings], blocked)
            return result

        except Exception as e:
            latency = time.time() - start_time

            # NOTE: using provider as key_id — interim simplification pending per-credential routing
            sanitized = _sanitize_error(e, secret="")
            await metrics_tracker.record_error(
                key_id=provider,
                provider=provider,
                error=sanitized,
            )
            logger.error("❌ %s | latency=%.2fs | error=%s", routed_model, latency, sanitized)
            raise HTTPException(status_code=500, detail=sanitized) from None

    async def _invoke_via_gateway(
        self, payload: GatewayRequest, routing_result: Any, config: BackgroundManagerConfig,
    ) -> JsonObject | Response:
        """Invoke upstream via AI Gateway routing result."""
        metrics_tracker = get_metrics_tracker()
        cost_tracker = get_cost_tracker()

        holone_service, compression_service = self._sync_pipeline_config(config)

        # HoloNe request inspection
        if holone_service.config.enabled:
            request_findings = holone_service.inspect_request(_required_messages(payload))
            if request_findings and holone_service.config.mode == "block":
                logger.warning("HoloNe blocked request: %s", [f.rule_id for f in request_findings])
                raise HTTPException(status_code=403, detail="Blocked by HoloNe")

        # Compression: compress input messages
        messages = _required_messages(payload)
        if compression_service.config.enabled:
            messages = compression_service.compress_input(messages)

        client_has_tools = bool(payload.tools or getattr(payload, "tool_choice", None))
        start_time = time.time()

        try:
            response = await routing_result.adapter.invoke(
                base_url=routing_result.endpoint.base_url,
                secret=routing_result.secret,
                model=routing_result.upstream_model.upstream_model_id,
                messages=messages,
                stream=payload.stream,
                default_headers=routing_result.default_headers,
            )

            latency = time.time() - start_time

            # Extract tokens from response (if available)
            input_tokens = 0
            output_tokens = 0
            if not payload.stream and hasattr(response, "usage"):
                usage = response.usage
                input_tokens = getattr(usage, "prompt_tokens", 0)
                output_tokens = getattr(usage, "completion_tokens", 0)

            # Record metrics and cost (per-credential, per-endpoint granularity)
            await metrics_tracker.record_success(
                key_id=routing_result.credential.id,
                provider=routing_result.endpoint.name,
                latency=latency,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            await cost_tracker.record_usage(
                key_id=routing_result.credential.id,
                model=routing_result.upstream_model.upstream_model_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )

            logger.info(
                "✅ AI Gateway %s | latency=%.2fs | tokens=%d/%d",
                routing_result.upstream_model.upstream_model_id, latency, input_tokens, output_tokens,
            )

            # Record success (non-fatal if DB is unavailable)
            try:
                async def _record_success(session):
                    await self._routing_engine.record_result(
                        session,
                        credential_id=routing_result.credential.id,
                        endpoint_id=routing_result.endpoint.id,
                        error=None,
                        http_status=200,
                    )
                await run_in_session(_record_success)
            except Exception:
                logger.warning("Failed to record gateway success to routing engine", exc_info=True)

            if payload.stream:
                result, _ = await self._stream_response(response, client_has_tools=client_has_tools)
            else:
                result = _json_object(response)
                if holone_service.config.enabled:
                    result, findings, blocked = holone_service.inspect_response_openai(
                        result, client_has_tools=client_has_tools
                    )
                    if findings:
                        logger.info("HoloNe findings: %s (blocked=%s)", [f.rule_id for f in findings], blocked)
            return result

        except Exception as e:
            latency = time.time() - start_time
            sanitized = _sanitize_error(e, secret=routing_result.secret)
            await metrics_tracker.record_error(
                key_id=routing_result.credential.id,
                provider=routing_result.endpoint.name,
                error=sanitized,
            )
            logger.error(
                "❌ AI Gateway %s | latency=%.2fs | error=%s",
                routing_result.upstream_model.upstream_model_id, latency, sanitized,
            )
            # Record failure to routing engine (non-fatal if DB is unavailable)
            exc = e  # capture for closure — PEP 3110 deletes `e` after except block
            try:
                async def _record_failure(session):
                    await self._routing_engine.record_result(
                        session,
                        credential_id=routing_result.credential.id,
                        endpoint_id=routing_result.endpoint.id,
                        error=routing_result.adapter.classify_error(exc),
                        http_status=None,
                    )
                await run_in_session(_record_failure)
            except Exception:
                logger.warning("Failed to record gateway failure to routing engine", exc_info=True)
            raise

    async def messages(self, payload: GatewayRequest) -> JsonObject | Response:
        config = await self._load_config()

        # Try AI Gateway routing first
        routing_results = await self._try_ai_gateway_route(payload)
        if routing_results is not None:
            for routing_result in routing_results:
                if not await self._is_endpoint_available(routing_result.endpoint.id):
                    logger.debug(
                        "Skipping candidate on endpoint %s — circuit open",
                        routing_result.endpoint.id,
                    )
                    continue
                try:
                    return await self._invoke_via_gateway_messages(payload, routing_result, config)
                except Exception as e:
                    logger.warning(
                        "AI Gateway invoke failed for %s (credential=%s): %s — trying next candidate",
                        payload.model, routing_result.credential.id[:8], e,
                    )

        # Fall back to LiteLLM Router
        routed_model = _routed_model(payload, config)
        router = await self._current_router(config)
        model = routed_model.split("/", 1)[1] if "/" in routed_model else routed_model

        # Extract provider from model name
        provider = routed_model.split("/", 1)[0] if "/" in routed_model else "unknown"

        # Track metrics
        metrics_tracker = get_metrics_tracker()
        rate_limiter = get_rate_limiter()
        cost_tracker = get_cost_tracker()

        holone_service, compression_service = self._sync_pipeline_config(config)

        # Check rate limit
        # NOTE: using provider as key_id — interim simplification pending per-credential routing
        if not await rate_limiter.can_use(provider, provider):
            logger.warning("Rate limit exceeded for provider %s", provider)
            raise HTTPException(status_code=429, detail="Rate limit exceeded")

        # HoloNe request inspection
        if holone_service.config.enabled:
            request_findings = holone_service.inspect_request(_required_messages(payload))
            if request_findings and holone_service.config.mode == "block":
                logger.warning("HoloNe blocked request: %s", [f.rule_id for f in request_findings])
                raise HTTPException(status_code=403, detail="Blocked by HoloNe")

        # Compression: compress input messages
        messages = _required_messages(payload)
        if compression_service.config.enabled:
            messages = compression_service.compress_input(messages)

        client_has_tools = bool(payload.tools or getattr(payload, "tool_choice", None))
        start_time = time.time()
        try:
            response = await router.aanthropic_messages(
                model=model,
                messages=messages,
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
            # NOTE: using provider as key_id — interim simplification pending per-credential routing
            await metrics_tracker.record_success(
                key_id=provider,
                provider=provider,
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
                result, _ = await self._stream_anthropic_response(response, client_has_tools=client_has_tools)
            else:
                result = _json_object(response)
                # Compression: compress output response
                if compression_service.config.enabled:
                    result = compression_service.compress_output(result)
                if holone_service.config.enabled:
                    result, findings, blocked = holone_service.inspect_response_openai(
                        result, client_has_tools=client_has_tools
                    )
                    if findings:
                        logger.info("HoloNe findings: %s (blocked=%s)", [f.rule_id for f in findings], blocked)
            return result

        except Exception as e:
            latency = time.time() - start_time

            # NOTE: using provider as key_id — interim simplification pending per-credential routing
            sanitized = _sanitize_error(e, secret="")
            await metrics_tracker.record_error(
                key_id=provider,
                provider=provider,
                error=sanitized,
            )
            logger.error("❌ %s | latency=%.2fs | error=%s", routed_model, latency, sanitized)
            raise HTTPException(status_code=500, detail=sanitized) from None

    async def _invoke_via_gateway_messages(
        self, payload: GatewayRequest, routing_result: Any, config: BackgroundManagerConfig,
    ) -> JsonObject | Response:
        """Invoke upstream via AI Gateway routing result (Anthropic Messages API)."""
        metrics_tracker = get_metrics_tracker()
        cost_tracker = get_cost_tracker()

        holone_service, compression_service = self._sync_pipeline_config(config)

        # HoloNe request inspection
        if holone_service.config.enabled:
            request_findings = holone_service.inspect_request(_required_messages(payload))
            if request_findings and holone_service.config.mode == "block":
                logger.warning("HoloNe blocked request: %s", [f.rule_id for f in request_findings])
                raise HTTPException(status_code=403, detail="Blocked by HoloNe")

        # Compression: compress input messages
        messages = _required_messages(payload)
        if compression_service.config.enabled:
            messages = compression_service.compress_input(messages)

        client_has_tools = bool(payload.tools or getattr(payload, "tool_choice", None))
        start_time = time.time()

        try:
            response = await routing_result.adapter.invoke(
                base_url=routing_result.endpoint.base_url,
                secret=routing_result.secret,
                model=routing_result.upstream_model.upstream_model_id,
                messages=messages,
                stream=payload.stream,
                default_headers=routing_result.default_headers,
            )

            latency = time.time() - start_time

            # Extract tokens from response (if available)
            input_tokens = 0
            output_tokens = 0
            if not payload.stream and hasattr(response, "usage"):
                usage = response.usage
                input_tokens = getattr(usage, "input_tokens", 0)
                output_tokens = getattr(usage, "output_tokens", 0)

            # Record metrics and cost (per-credential, per-endpoint granularity)
            await metrics_tracker.record_success(
                key_id=routing_result.credential.id,
                provider=routing_result.endpoint.name,
                latency=latency,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            await cost_tracker.record_usage(
                key_id=routing_result.credential.id,
                model=routing_result.upstream_model.upstream_model_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )

            logger.info(
                "✅ AI Gateway messages %s | latency=%.2fs | tokens=%d/%d",
                routing_result.upstream_model.upstream_model_id, latency, input_tokens, output_tokens,
            )

            # Record success (non-fatal if DB is unavailable)
            try:
                async def _record_success(session):
                    await self._routing_engine.record_result(
                        session,
                        credential_id=routing_result.credential.id,
                        endpoint_id=routing_result.endpoint.id,
                        error=None,
                        http_status=200,
                    )
                await run_in_session(_record_success)
            except Exception:
                logger.warning("Failed to record gateway success to routing engine", exc_info=True)

            if payload.stream:
                result, _ = await self._stream_anthropic_response(response, client_has_tools=client_has_tools)
            else:
                result = _json_object(response)
                if compression_service.config.enabled:
                    result = compression_service.compress_output(result)
                if holone_service.config.enabled:
                    result, findings, blocked = holone_service.inspect_response_openai(
                        result, client_has_tools=client_has_tools
                    )
                    if findings:
                        logger.info("HoloNe findings: %s (blocked=%s)", [f.rule_id for f in findings], blocked)
            return result

        except Exception as e:
            latency = time.time() - start_time
            sanitized = _sanitize_error(e, secret=routing_result.secret)
            await metrics_tracker.record_error(
                key_id=routing_result.credential.id,
                provider=routing_result.endpoint.name,
                error=sanitized,
            )
            logger.error(
                "❌ AI Gateway messages %s | latency=%.2fs | error=%s",
                routing_result.upstream_model.upstream_model_id, latency, sanitized,
            )
            # Record failure to routing engine (non-fatal if DB is unavailable)
            exc = e  # capture for closure — PEP 3110 deletes `e` after except block
            try:
                async def _record_failure(session):
                    await self._routing_engine.record_result(
                        session,
                        credential_id=routing_result.credential.id,
                        endpoint_id=routing_result.endpoint.id,
                        error=routing_result.adapter.classify_error(exc),
                        http_status=None,
                    )
                await run_in_session(_record_failure)
            except Exception:
                logger.warning("Failed to record gateway failure to routing engine", exc_info=True)
            raise

    async def responses(self, payload: GatewayRequest) -> JsonObject | Response:
        config = await self._load_config()

        # Try AI Gateway routing first
        routing_results = await self._try_ai_gateway_route(payload)
        if routing_results is not None:
            for routing_result in routing_results:
                if not await self._is_endpoint_available(routing_result.endpoint.id):
                    logger.debug(
                        "Skipping candidate on endpoint %s — circuit open",
                        routing_result.endpoint.id,
                    )
                    continue
                try:
                    return await self._invoke_via_gateway_responses(payload, routing_result, config)
                except Exception as e:
                    logger.warning(
                        "AI Gateway invoke failed for %s (credential=%s): %s — trying next candidate",
                        payload.model, routing_result.credential.id[:8], e,
                    )

        # Fall back to LiteLLM Router
        routed_model = _routed_model(payload, config)
        router = await self._current_router(config)

        # Extract provider from model name
        provider = routed_model.split("/", 1)[0] if "/" in routed_model else "unknown"

        # Track metrics
        metrics_tracker = get_metrics_tracker()
        rate_limiter = get_rate_limiter()
        cost_tracker = get_cost_tracker()

        holone_service, compression_service = self._sync_pipeline_config(config)

        # Check rate limit
        # NOTE: using provider as key_id — interim simplification pending per-credential routing
        if not await rate_limiter.can_use(provider, provider):
            logger.warning("Rate limit exceeded for provider %s", provider)
            raise HTTPException(status_code=429, detail="Rate limit exceeded")

        # HoloNe request inspection (responses API uses input field)
        if holone_service.config.enabled and payload.input:
            text = json.dumps(payload.input) if isinstance(payload.input, (dict, list)) else str(payload.input)
            from stitch_backend.domains.ai_proxy.holone_inspector import default_engine as _de
            request_findings = _de().inspect(text, source="request")
            if request_findings and holone_service.config.mode == "block":
                logger.warning("HoloNe blocked request: %s", [f.rule_id for f in request_findings])
                raise HTTPException(status_code=403, detail="Blocked by HoloNe")

        # Compression: compress input (responses API uses input field)
        input_data = payload.input
        if compression_service.config.enabled and isinstance(input_data, str):
            from stitch_backend.domains.ai_proxy.compression.caveman import compress_text
            input_data = compress_text(input_data, level=compression_service.config.level)

        client_has_tools = False  # Responses API doesn't use client tool advertisement
        start_time = time.time()
        try:
            response = await router.aresponses(
                model=routed_model,
                input=input_data,
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
            # NOTE: using provider as key_id — interim simplification pending per-credential routing
            await metrics_tracker.record_success(
                key_id=provider,
                provider=provider,
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
                result, _ = await self._stream_response(response, client_has_tools=client_has_tools)
            else:
                result = _json_object(response)
                # Compression: compress output response
                if compression_service.config.enabled:
                    result = compression_service.compress_output(result)
                if holone_service.config.enabled:
                    result, findings, blocked = holone_service.inspect_response_openai(
                        result, client_has_tools=client_has_tools
                    )
                    if findings:
                        logger.info("HoloNe findings: %s (blocked=%s)", [f.rule_id for f in findings], blocked)
            return result

        except Exception as e:
            latency = time.time() - start_time

            # NOTE: using provider as key_id — interim simplification pending per-credential routing
            sanitized = _sanitize_error(e, secret="")
            await metrics_tracker.record_error(
                key_id=provider,
                provider=provider,
                error=sanitized,
            )
            logger.error("❌ %s | latency=%.2fs | error=%s", routed_model, latency, sanitized)
            raise HTTPException(status_code=500, detail=sanitized) from None

    async def _invoke_via_gateway_responses(
        self, payload: GatewayRequest, routing_result: Any, config: BackgroundManagerConfig,
    ) -> JsonObject | Response:
        """Invoke upstream via AI Gateway routing result (Responses API)."""
        metrics_tracker = get_metrics_tracker()
        cost_tracker = get_cost_tracker()

        holone_service, compression_service = self._sync_pipeline_config(config)

        # HoloNe request inspection (responses API uses input field)
        if holone_service.config.enabled and payload.input:
            text = json.dumps(payload.input) if isinstance(payload.input, (dict, list)) else str(payload.input)
            from stitch_backend.domains.ai_proxy.holone_inspector import default_engine as _de
            request_findings = _de().inspect(text, source="request")
            if request_findings and holone_service.config.mode == "block":
                logger.warning("HoloNe blocked request: %s", [f.rule_id for f in request_findings])
                raise HTTPException(status_code=403, detail="Blocked by HoloNe")

        # Compression: compress input (responses API uses input field)
        input_data = payload.input
        if compression_service.config.enabled and isinstance(input_data, str):
            from stitch_backend.domains.ai_proxy.compression.caveman import compress_text
            input_data = compress_text(input_data, level=compression_service.config.level)

        client_has_tools = False  # Responses API doesn't use client tool advertisement
        start_time = time.time()

        try:
            response = await routing_result.adapter.invoke_responses(
                base_url=routing_result.endpoint.base_url,
                secret=routing_result.secret,
                model=routing_result.upstream_model.upstream_model_id,
                input=input_data,
                stream=payload.stream,
                default_headers=routing_result.default_headers,
            )

            latency = time.time() - start_time

            # Extract tokens from response (if available)
            input_tokens = 0
            output_tokens = 0
            if not payload.stream and hasattr(response, "usage"):
                usage = response.usage
                input_tokens = getattr(usage, "prompt_tokens", 0)
                output_tokens = getattr(usage, "completion_tokens", 0)

            # Record metrics and cost (per-credential, per-endpoint granularity)
            await metrics_tracker.record_success(
                key_id=routing_result.credential.id,
                provider=routing_result.endpoint.name,
                latency=latency,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            await cost_tracker.record_usage(
                key_id=routing_result.credential.id,
                model=routing_result.upstream_model.upstream_model_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )

            logger.info(
                "✅ AI Gateway responses %s | latency=%.2fs | tokens=%d/%d",
                routing_result.upstream_model.upstream_model_id, latency, input_tokens, output_tokens,
            )

            # Record success (non-fatal if DB is unavailable)
            try:
                async def _record_success(session):
                    await self._routing_engine.record_result(
                        session,
                        credential_id=routing_result.credential.id,
                        endpoint_id=routing_result.endpoint.id,
                        error=None,
                        http_status=200,
                    )
                await run_in_session(_record_success)
            except Exception:
                logger.warning("Failed to record gateway success to routing engine", exc_info=True)

            if payload.stream:
                result, _ = await self._stream_response(response, client_has_tools=client_has_tools)
            else:
                result = _json_object(response)
                if compression_service.config.enabled:
                    result = compression_service.compress_output(result)
                if holone_service.config.enabled:
                    result, findings, blocked = holone_service.inspect_response_openai(
                        result, client_has_tools=client_has_tools
                    )
                    if findings:
                        logger.info("HoloNe findings: %s (blocked=%s)", [f.rule_id for f in findings], blocked)
            return result

        except Exception as e:
            latency = time.time() - start_time
            sanitized = _sanitize_error(e, secret=routing_result.secret)
            await metrics_tracker.record_error(
                key_id=routing_result.credential.id,
                provider=routing_result.endpoint.name,
                error=sanitized,
            )
            logger.error(
                "❌ AI Gateway responses %s | latency=%.2fs | error=%s",
                routing_result.upstream_model.upstream_model_id, latency, sanitized,
            )
            # Record failure to routing engine (non-fatal if DB is unavailable)
            exc = e  # capture for closure — PEP 3110 deletes `e` after except block
            try:
                async def _record_failure(session):
                    await self._routing_engine.record_result(
                        session,
                        credential_id=routing_result.credential.id,
                        endpoint_id=routing_result.endpoint.id,
                        error=routing_result.adapter.classify_error(exc),
                        http_status=None,
                    )
                await run_in_session(_record_failure)
            except Exception:
                logger.warning("Failed to record gateway failure to routing engine", exc_info=True)
            raise

    async def models(self) -> JsonObject:
        """Return available models — PublicModel from AI Gateway, fallback to LiteLLM providers."""
        # Try AI Gateway first
        try:
            async def _get_models(session):
                return await self._routing_engine.get_available_public_models(session)

            public_models = await run_in_session(_get_models)
            if public_models:
                return {
                    "object": "list",
                    "data": [
                        {
                            "id": m.id,
                            "object": "model",
                            "owned_by": "stitch",
                            "display_name": m.display_name,
                            "contract": m.contract,
                        }
                        for m in public_models
                    ],
                }
        except Exception as e:
            logger.debug("AI Gateway models unavailable: %s", e)

        # Fall back to LiteLLM providers
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
        self, response: Any, *, client_has_tools: bool = False
    ) -> tuple[StreamingResponse, int | None]:
        chunks: list[str] = []
        actual_tokens: int | None = None
        async for chunk in response:
            value = chunk.model_dump(mode="json", exclude_none=True)
            chunks.append(f"data: {json.dumps(value, separators=(',', ':'))}\n\n")
            actual_tokens = _usage_tokens(value) or actual_tokens
        chunks.append("data: [DONE]\n\n")

        body = "".join(chunks)
        holone_service = get_holone_service()
        if holone_service.config.enabled:
            result = holone_service.inspect_stream_openai(body, client_has_tools=client_has_tools)
            if result.findings:
                logger.info("HoloNe stream findings: %s (blocked=%s)", [f.rule_id for f in result.findings], result.blocked)
            body = result.body

        async def body_gen():
            yield body.encode("utf-8")

        return StreamingResponse(body_gen(), media_type="text/event-stream"), actual_tokens

    async def _stream_anthropic_response(
        self, response: Any, *, client_has_tools: bool = False
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

        body = "".join(chunks)
        holone_service = get_holone_service()
        if holone_service.config.enabled:
            result = holone_service.inspect_stream_anthropic(body, client_has_tools=client_has_tools)
            if result.findings:
                logger.info("HoloNe stream findings: %s (blocked=%s)", [f.rule_id for f in result.findings], result.blocked)
            body = result.body

        async def body_gen():
            yield body.encode("utf-8")

        actual_tokens = input_tokens + output_tokens if found_usage else None
        return StreamingResponse(body_gen(), media_type="text/event-stream"), actual_tokens


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
