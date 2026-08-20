from __future__ import annotations

import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any, Protocol, cast

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import exc as sqlalchemy_exc

from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway import circuit_breaker
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error
from stitch_backend.domains.ai_gateway.routing_engine import GatewayRequest as AIGatewayRequest
from stitch_backend.domains.ai_gateway.routing_engine import PoolScope, RoutingEngine, RoutingError
from stitch_backend.domains.ai_gateway.usage_tracker import record_usage as _record_group_usage
from stitch_backend.domains.ai_proxy.compression.service import get_compression_service
from stitch_backend.domains.ai_proxy.cost_tracker import get_cost_tracker
from stitch_backend.domains.ai_proxy.holone_inspector import (
    default_engine as _holone_default_engine,
)
from stitch_backend.domains.ai_proxy.holone_service import get_holone_service
from stitch_backend.domains.ai_proxy.key_metrics import get_metrics_tracker
from stitch_backend.domains.background_manager.schemas import BackgroundManagerConfig

if TYPE_CHECKING:
    from starlette.responses import Response

    from stitch_backend.domains.ai_proxy.litellm_gateway import (
        GatewayRequest,
        JsonObject,
        JsonValue,
    )

logger = logging.getLogger(__name__)


class CompletionRouter(Protocol):
    """Structural protocol for a LiteLLM-compatible completion router.

    Kept as a documentation anchor for the adapter seam (see
    ``ai_gateway/adapters/base.py``). The executor no longer instantiates
    a LiteLLM Router — all routing goes through the AI Gateway
    :class:`RoutingEngine`.
    """

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


ConfigLoader = Callable[[], Awaitable[BackgroundManagerConfig]]


class LiteLLMExecutor:
    """AI Gateway routing executor.

    All request routing goes through the AI Gateway :class:`RoutingEngine`.
    The LiteLLM Router config path (``_current_router``, ``_providers``,
    ``build_router``) was removed in the L2 final wave — the executor no
    longer instantiates or falls back to a LiteLLM Router.

    Keeps: cost tracker, holone, compression, adapters, circuit breaker,
    and the startup PublicModel auto-create from BackgroundManagerConfig.
    """

    def __init__(
        self,
        load_config: ConfigLoader | None = None,
    ) -> None:
        self._load_config = load_config or _default_config
        self._routing_engine = RoutingEngine()

    async def _try_ai_gateway_route(
        self, payload: GatewayRequest, pool: PoolScope | None = None,
    ) -> list[Any] | None:
        """Attempt routing via AI Gateway engine. Returns list of routing candidates or None."""
        try:
            gw_request = AIGatewayRequest(
                model=cast("str", payload.model),
                messages=payload.messages or [],
                stream=payload.stream,
                tools=payload.tools,
                response_format=cast("Any", payload).response_format,
            )

            async def _route(session):
                return await self._routing_engine.route(session, gw_request, pool=pool)

            routing_results = await run_in_session(_route)
            if not routing_results:
                logger.debug("AI Gateway route returned empty list for %s", payload.model)
                return None
            first = routing_results[0]
            logger.info(
                "gateway route caller=%s credential=%s owner=%s group_hit=%s",
                pool.owner_user_id if pool else None,
                first.credential.id[:8],
                first.credential.owner_id,
                first.group_id_hit,
            )
            logger.info(
                "AI Gateway route: %s → %d candidate(s), first: %s/%s (credential=%s)",
                payload.model,
                len(routing_results),
                first.endpoint.name,
                first.upstream_model.upstream_model_id,
                first.credential.id[:8],
            )
            return cast("list[Any] | None", routing_results)
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

    async def chat(self, payload: GatewayRequest, pool: PoolScope | None = None) -> JsonObject | Response:
        config = await self._load_config()

        # Try AI Gateway routing first
        routing_results = await self._try_ai_gateway_route(payload, pool=pool)
        if routing_results is not None:
            for routing_result in routing_results:
                if not await self._is_endpoint_available(routing_result.endpoint.id):
                    logger.debug(
                        "Skipping candidate on endpoint %s — circuit open",
                        routing_result.endpoint.id,
                    )
                    continue
                try:
                    result = await self._invoke_via_gateway(payload, routing_result, config)
                except Exception as e:
                    logger.warning(
                        "AI Gateway invoke failed for %s (credential=%s): %s — trying next candidate",
                        payload.model, routing_result.credential.id[:8], e,
                    )
                    continue
                if pool is not None and pool.owner_user_id is not None:
                    await _record_group_usage(
                        pool.owner_user_id,
                        routing_result.group_id_hit,
                    )
                return result

        # No route available — LiteLLM Router fallback removed (L2 final wave).
        raise HTTPException(
            status_code=503,
            detail={"error": {"message": f"No route available for model: {payload.model}"}},
        )

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
                result = cast("Any", _json_object(response))
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

    async def messages(self, payload: GatewayRequest, pool: PoolScope | None = None) -> JsonObject | Response:
        config = await self._load_config()

        # Try AI Gateway routing first
        routing_results = await self._try_ai_gateway_route(payload, pool=pool)
        if routing_results is not None:
            for routing_result in routing_results:
                if not await self._is_endpoint_available(routing_result.endpoint.id):
                    logger.debug(
                        "Skipping candidate on endpoint %s — circuit open",
                        routing_result.endpoint.id,
                    )
                    continue
                try:
                    result = await self._invoke_via_gateway_messages(payload, routing_result, config)
                except Exception as e:
                    logger.warning(
                        "AI Gateway invoke failed for %s (credential=%s): %s — trying next candidate",
                        payload.model, routing_result.credential.id[:8], e,
                    )
                    continue
                if pool is not None and pool.owner_user_id is not None:
                    await _record_group_usage(
                        pool.owner_user_id,
                        routing_result.group_id_hit,
                    )
                return result

        # No route available — LiteLLM Router fallback removed (L2 final wave).
        raise HTTPException(
            status_code=503,
            detail={"error": {"message": f"No route available for model: {payload.model}"}},
        )

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
                result = cast("Any", _json_object(response))
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

    async def responses(self, payload: GatewayRequest, pool: PoolScope | None = None) -> JsonObject | Response:
        config = await self._load_config()

        # Try AI Gateway routing first
        routing_results = await self._try_ai_gateway_route(payload, pool=pool)
        if routing_results is not None:
            for routing_result in routing_results:
                if not await self._is_endpoint_available(routing_result.endpoint.id):
                    logger.debug(
                        "Skipping candidate on endpoint %s — circuit open",
                        routing_result.endpoint.id,
                    )
                    continue
                try:
                    result = await self._invoke_via_gateway_responses(payload, routing_result, config)
                except Exception as e:
                    logger.warning(
                        "AI Gateway invoke failed for %s (credential=%s): %s — trying next candidate",
                        payload.model, routing_result.credential.id[:8], e,
                    )
                    continue
                if pool is not None and pool.owner_user_id is not None:
                    await _record_group_usage(
                        pool.owner_user_id,
                        routing_result.group_id_hit,
                    )
                return result

        # No route available — LiteLLM Router fallback removed (L2 final wave).
        raise HTTPException(
            status_code=503,
            detail={"error": {"message": f"No route available for model: {payload.model}"}},
        )

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
            request_findings = _holone_default_engine().inspect(text, source="request")
            if request_findings and holone_service.config.mode == "block":
                logger.warning("HoloNe blocked request: %s", [f.rule_id for f in request_findings])
                raise HTTPException(status_code=403, detail="Blocked by HoloNe")

        # Compression: compress input (responses API uses input field).
        # Mirror the messages path (compress_input) flags: only compress
        # when config.enabled AND config.caveman_enabled AND
        # config.input_compression_enabled.  config.level is the
        # @property returning CompressionLevel enum (derived from
        # config.caveman_level string) — compress_text expects the enum.
        input_data = payload.input
        if (
            compression_service.config.enabled
            and compression_service.config.caveman_enabled
            and compression_service.config.input_compression_enabled
            and isinstance(input_data, str)
        ):
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
                result = cast("Any", _json_object(response))
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

    async def models(self, pool: PoolScope | None = None) -> JsonObject:
        """Return available models from the AI Gateway PublicModel catalog.

        LiteLLM Router fallback removed (L2 final wave) — the gateway
        PublicModel table is the sole source of model listings. The startup
        :func:`auto_create_public_models_from_config` step ensures the
        catalog is populated from BackgroundManagerConfig providers.
        """
        try:
            async def _get_models(session):
                return await self._routing_engine.get_available_public_models(session, pool=pool)

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

        return {"object": "list", "data": []}

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


# ── L2: PublicModel auto-create from legacy BackgroundManagerConfig ──────────
#
# Startup step that auto-creates PublicModel rows from the legacy
# BackgroundManagerConfig providers when none exist (idempotent, owner_id
# NULL). When this succeeds, the LiteLLM-config fallback in ``models()``
# is removed (returns empty instead). When it fails, the fallback is kept.
#
# P2.15 — ``_public_models_auto_created_flag=True`` with 0 providers is
# intentional: an empty catalog is the product default when no providers
# are configured.  The flag means "the auto-create step ran successfully"
# (not "rows were created").  Returning True with 0 providers prevents
# the LiteLLM fallback from kicking in (there is no LiteLLM Router
# anymore — the fallback would just return an empty list anyway).

_public_models_auto_created_flag: bool = False


def _public_models_auto_created() -> bool:
    """True if the startup auto-create step succeeded (fallback removed)."""
    return _public_models_auto_created_flag


async def auto_create_public_models_from_config(
    load_config: ConfigLoader | None = None,
) -> bool:
    """Auto-create PublicModels from legacy BackgroundManagerConfig providers.

    Runs at startup. Creates one PublicModel per provider in
    ``BackgroundManagerConfig.provider_priority`` (or derived from loaded
    keys) when no PublicModels exist. Idempotent — safe to call on every
    boot. owner_id = NULL (instance-shared).

    Returns True if the step succeeded (flag set), False on any exception
    (caller keeps the LiteLLM fallback).
    """
    global _public_models_auto_created_flag

    try:
        from sqlalchemy import func, select

        from stitch_backend.database import run_in_read_session, run_in_session
        from stitch_backend.domains.ai_gateway.models import PublicModel
        from stitch_backend.domains.ai_gateway.service import PublicModelService

        # Check if any PublicModels exist.
        async def _count(session):
            result = await session.execute(select(func.count()).select_from(PublicModel))
            return int(result.scalar_one())

        existing = await run_in_read_session(_count)
        if existing > 0:
            # PublicModels already exist — no auto-create needed, but the
            # gate is "succeeded" (existing rows serve the same purpose).
            _public_models_auto_created_flag = True
            return True

        # Load config + keys to discover providers.
        config = await (load_config or _default_config)()
        provider_keys = await _load_keys_for_auto_create()

        # Derive provider list from config.provider_priority + loaded keys.
        providers: set[str] = set()
        providers.update(config.provider_priority)
        providers.update(provider_keys.keys())
        # Filter out sentinel/internal keys.
        providers.discard("__custom_providers__")

        if not providers:
            # No providers configured — nothing to create, but the step
            # "succeeded" (there's just nothing to do).
            _public_models_auto_created_flag = True
            return True

        async def _create(session):
            svc = PublicModelService(session)
            for provider in sorted(providers):
                model_id = f"{provider}/*"
                # Idempotent: check before create.
                result = await session.execute(
                    select(PublicModel).where(PublicModel.id == model_id)
                )
                if result.scalar_one_or_none() is not None:
                    continue
                await svc.create_public_model(
                    model_id,
                    display_name=provider,
                    enabled=True,
                    owner_id=None,
                )
            # P2.12: flush, not commit — run_in_session commits the
            # outer transaction after the callback returns.
            await session.flush()

        await run_in_session(_create)
        _public_models_auto_created_flag = True
        logger.info(
            "PublicModel auto-create succeeded: %d providers", len(providers),
        )
        return True
    except Exception as exc:
        logger.warning(
            "PublicModel auto-create failed — keeping LiteLLM fallback: %s", exc,
        )
        _public_models_auto_created_flag = False
        return False


async def _load_keys_for_auto_create() -> dict[str, list[dict]]:
    """Load provider keys for the auto-create step.

    Mirrors the executor's former key loader (which fed ``_providers``)
    so the PublicModel auto-create covers every provider the LiteLLM
    Router would have served — including custom providers, which the
    original built-in-only list missed (L2 gap fix). Safe fallback when
    the real loader is unavailable (e.g. during tests).
    """
    try:
        from stitch_backend.database import run_in_read_session
        from stitch_backend.domains.api_keys.custom_providers import (
            custom_provider_db_key,
            get_custom_providers,
        )
        from stitch_backend.domains.api_keys.service import ApiKeysService

        async def _load(session):
            svc = ApiKeysService(session)
            result: dict[str, list[dict]] = {}
            for provider in (
                "openai", "anthropic", "gemini", "antigravity",
                "fireworks", "zai", "dashscope",
            ):
                try:
                    keys = await svc.get_keys(provider)
                    if keys:
                        result[provider] = keys
                except Exception:
                    pass

            # Custom providers — gap fix: the former ``_providers`` field
            # was populated from ``_deployment_configs`` which included
            # custom providers. The auto-create must cover them too.
            try:
                custom_providers = await get_custom_providers(session)
                for cp in custom_providers:
                    cp_keys = await svc.get_keys_by_db_key(custom_provider_db_key(cp.id))
                    if cp_keys:
                        result[f"custom_{cp.id}"] = cp_keys
            except Exception:
                pass

            return result

        return await run_in_read_session(_load)
    except Exception:
        return {}
