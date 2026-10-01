from __future__ import annotations

import json
import logging
import time
from typing import TYPE_CHECKING, Any, cast

from fastapi import HTTPException

from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error
from stitch_backend.domains.ai_proxy.holone_inspector import (
    default_engine as _holone_default_engine,
)
from stitch_backend.domains.ai_proxy.litellm_response_parsing import _json_object

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from starlette.responses import Response

    from stitch_backend.domains.ai_gateway.routing_engine import PoolScope
    from stitch_backend.domains.ai_proxy.litellm_executor import LiteLLMExecutor
    from stitch_backend.domains.ai_proxy.litellm_gateway import (
        GatewayRequest,
        JsonObject,
        JsonValue,
    )
    from stitch_backend.domains.background_manager.schemas import BackgroundManagerConfig

logger = logging.getLogger(__name__)


def _required_messages(payload: GatewayRequest) -> list[dict[str, JsonValue]]:
    if payload.messages is None:
        raise HTTPException(
            status_code=422, detail={"error": {"message": "messages are required"}}
        )
    return payload.messages


async def invoke_via_gateway(
    executor: LiteLLMExecutor,
    payload: GatewayRequest,
    routing_result: Any,
    config: BackgroundManagerConfig,
    pool: PoolScope | None = None,
    *,
    get_metrics_tracker: Callable[[], Any],
    get_cost_tracker: Callable[[], Any],
    run_in_session: Callable[..., Awaitable[Any]],
) -> JsonObject | Response:
    metrics_tracker = get_metrics_tracker()
    cost_tracker = get_cost_tracker()

    holone_service, compression_service = executor._sync_pipeline_config(config)

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
                await executor._routing_engine.record_result(
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
            result = await executor._stream_response(
                executor._guard_stream(response, routing_result),
                client_has_tools=client_has_tools,
                on_complete=lambda tokens: executor._record_group_usage_for(
                    pool, routing_result, payload.model, tokens,
                ),
            )
        else:
            result = cast("Any", _json_object(response))
            if holone_service.config.enabled:
                result, findings, blocked = holone_service.inspect_response_openai(
                    result, client_has_tools=client_has_tools
                )
                if findings:
                    logger.info("HoloNe findings: %s (blocked=%s)", [f.rule_id for f in findings], blocked)
            await executor._record_group_usage_for(
                pool, routing_result, payload.model, input_tokens + output_tokens,
            )
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
                await executor._routing_engine.record_result(
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


async def invoke_via_gateway_messages(
    executor: LiteLLMExecutor,
    payload: GatewayRequest,
    routing_result: Any,
    config: BackgroundManagerConfig,
    pool: PoolScope | None = None,
    *,
    get_metrics_tracker: Callable[[], Any],
    get_cost_tracker: Callable[[], Any],
    run_in_session: Callable[..., Awaitable[Any]],
) -> JsonObject | Response:
    metrics_tracker = get_metrics_tracker()
    cost_tracker = get_cost_tracker()

    holone_service, compression_service = executor._sync_pipeline_config(config)

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
                await executor._routing_engine.record_result(
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
            result = await executor._stream_anthropic_response(
                executor._guard_stream(response, routing_result),
                client_has_tools=client_has_tools,
                on_complete=lambda tokens: executor._record_group_usage_for(
                    pool, routing_result, payload.model, tokens,
                ),
            )
        else:
            result = cast("Any", _json_object(response))
            if compression_service.config.enabled:
                result = compression_service.compress_output(result)
            if holone_service.config.enabled:
                result, findings, blocked = holone_service.inspect_response_anthropic(
                    result, client_has_tools=client_has_tools
                )
                if findings:
                    logger.info("HoloNe findings: %s (blocked=%s)", [f.rule_id for f in findings], blocked)
            await executor._record_group_usage_for(
                pool, routing_result, payload.model, input_tokens + output_tokens,
            )
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
                await executor._routing_engine.record_result(
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


async def invoke_via_gateway_responses(
    executor: LiteLLMExecutor,
    payload: GatewayRequest,
    routing_result: Any,
    config: BackgroundManagerConfig,
    pool: PoolScope | None = None,
    *,
    get_metrics_tracker: Callable[[], Any],
    get_cost_tracker: Callable[[], Any],
    run_in_session: Callable[..., Awaitable[Any]],
) -> JsonObject | Response:
    metrics_tracker = get_metrics_tracker()
    cost_tracker = get_cost_tracker()

    holone_service, compression_service = executor._sync_pipeline_config(config)

    # HoloNe request inspection (responses API uses input field)
    if holone_service.config.enabled and payload.input:
        text = json.dumps(payload.input) if isinstance(payload.input, (dict, list)) else str(payload.input)
        request_findings = _holone_default_engine().inspect(text, source="request")
        if request_findings and holone_service.config.mode == "block":
            logger.warning("HoloNe blocked request: %s", [f.rule_id for f in request_findings])
            raise HTTPException(status_code=403, detail="Blocked by HoloNe")

    # config.level is the enum property compress_text expects (not the raw caveman_level string)
    input_data = payload.input
    if (
        compression_service.config.enabled
        and compression_service.config.caveman_enabled
        and compression_service.config.input_compression_enabled
        and isinstance(input_data, str)
    ):
        from stitch_backend.domains.ai_proxy.compression.caveman import compress_text
        input_data = compress_text(input_data, level=compression_service.config.level)

    client_has_tools = bool(payload.tools or getattr(payload, "tool_choice", None))
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
                await executor._routing_engine.record_result(
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
            result = await executor._stream_response(
                executor._guard_stream(response, routing_result),
                client_has_tools=client_has_tools,
                on_complete=lambda tokens: executor._record_group_usage_for(
                    pool, routing_result, payload.model, tokens,
                ),
            )
        else:
            result = cast("Any", _json_object(response))
            if compression_service.config.enabled:
                result = compression_service.compress_output(result)
            if holone_service.config.enabled:
                result, findings, blocked = holone_service.inspect_response_responses(
                    result, client_has_tools=client_has_tools
                )
                if findings:
                    logger.info("HoloNe findings: %s (blocked=%s)", [f.rule_id for f in findings], blocked)
            await executor._record_group_usage_for(
                pool, routing_result, payload.model, input_tokens + output_tokens,
            )
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
                await executor._routing_engine.record_result(
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
