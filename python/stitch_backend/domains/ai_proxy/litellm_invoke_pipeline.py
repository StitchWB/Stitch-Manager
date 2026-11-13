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
from stitch_backend.domains.ai_proxy.litellm_response_parsing import _json_object, _usage_split

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from starlette.responses import Response

    from stitch_backend.domains.ai_gateway.routing_engine import PoolScope
    from stitch_backend.domains.ai_proxy.litellm_executor import LiteLLMExecutor, _RequestOutcome
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


def _adapter_options(payload: GatewayRequest) -> dict[str, Any]:
    return payload.model_dump(mode="json", exclude_none=True, exclude={
        "model", "provider", "messages", "input", "stream", "base_url", "secret", "default_headers",
    })


def _response_usage(response: Any) -> tuple[int, int]:
    """(input, output) tokens for a completed non-stream response.

    Adapters return a JSON dict; test doubles may expose a ``usage`` object.
    """
    if isinstance(response, dict):
        return _usage_split(response) or (0, 0)
    usage = getattr(response, "usage", None)
    if usage is None:
        return (0, 0)
    return (
        max(getattr(usage, "prompt_tokens", 0), getattr(usage, "input_tokens", 0)),
        max(getattr(usage, "completion_tokens", 0), getattr(usage, "output_tokens", 0)),
    )


async def _record_stream_usage(
    executor: LiteLLMExecutor,
    pool: PoolScope | None,
    routing_result: Any,
    payload: GatewayRequest,
    usage: tuple[int, int] | None,
    ok: bool,
    outcome: _RequestOutcome,
) -> None:
    input_tokens, output_tokens = usage if usage is not None else (0, 0)
    await executor._record_group_usage_for(
        pool, routing_result, payload.model, input_tokens + output_tokens,
    )
    outcome.input_tokens = input_tokens
    outcome.output_tokens = output_tokens
    outcome.ok = ok
    outcome.routing_result = routing_result
    outcome.error_class = None if ok else "stream_interrupted"
    await executor._persist_outcome(outcome)


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
    outcome: _RequestOutcome,
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
            **_adapter_options(payload),
        )

        latency = time.time() - start_time

        # Extract tokens from response (if available)
        input_tokens = 0
        output_tokens = 0
        if not payload.stream:
            input_tokens, output_tokens = _response_usage(response)

        if payload.stream:
            result = await executor._stream_response(
                executor._guard_stream(response, routing_result),
                client_has_tools=client_has_tools,
                on_complete=lambda usage, ok: _record_stream_usage(
                    executor, pool, routing_result, payload, usage, ok, outcome,
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

        # success only after first chunk, else failure window is cleared
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
                    upstream_model_id=routing_result.upstream_model.id,
                    error=None,
                    http_status=200,
                )
            await run_in_session(_record_success)
        except Exception:
            logger.warning("Failed to record gateway success to routing engine", exc_info=True)

        if not payload.stream:
            outcome.input_tokens = input_tokens
            outcome.output_tokens = output_tokens
            outcome.ok = True
            outcome.routing_result = routing_result

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
        classified = routing_result.adapter.classify_error(exc)
        outcome.routing_result = routing_result
        outcome.ok = False
        outcome.error_class = getattr(classified, "category", type(exc).__name__)
        try:
            async def _record_failure(session):
                await executor._routing_engine.record_result(
                    session,
                    credential_id=routing_result.credential.id,
                    endpoint_id=routing_result.endpoint.id,
                    upstream_model_id=routing_result.upstream_model.id,
                    error=classified,
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
    outcome: _RequestOutcome,
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
        invoke = getattr(routing_result.adapter, "invoke_messages", routing_result.adapter.invoke)
        response = await invoke(
            base_url=routing_result.endpoint.base_url,
            secret=routing_result.secret,
            model=routing_result.upstream_model.upstream_model_id,
            messages=messages,
            stream=payload.stream,
            default_headers=routing_result.default_headers,
            **_adapter_options(payload),
        )

        latency = time.time() - start_time

        # Extract tokens from response (if available)
        input_tokens = 0
        output_tokens = 0
        if not payload.stream:
            input_tokens, output_tokens = _response_usage(response)

        if payload.stream:
            result = await executor._stream_anthropic_response(
                executor._guard_stream(response, routing_result),
                client_has_tools=client_has_tools,
                on_complete=lambda usage, ok: _record_stream_usage(
                    executor, pool, routing_result, payload, usage, ok, outcome,
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

        # success only after first chunk, else failure window is cleared
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
                    upstream_model_id=routing_result.upstream_model.id,
                    error=None,
                    http_status=200,
                )
            await run_in_session(_record_success)
        except Exception:
            logger.warning("Failed to record gateway success to routing engine", exc_info=True)

        if not payload.stream:
            outcome.input_tokens = input_tokens
            outcome.output_tokens = output_tokens
            outcome.ok = True
            outcome.routing_result = routing_result

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
        classified = routing_result.adapter.classify_error(exc)
        outcome.routing_result = routing_result
        outcome.ok = False
        outcome.error_class = getattr(classified, "category", type(exc).__name__)
        try:
            async def _record_failure(session):
                await executor._routing_engine.record_result(
                    session,
                    credential_id=routing_result.credential.id,
                    endpoint_id=routing_result.endpoint.id,
                    upstream_model_id=routing_result.upstream_model.id,
                    error=classified,
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
    outcome: _RequestOutcome,
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
            **_adapter_options(payload),
        )

        latency = time.time() - start_time

        # Extract tokens from response (if available)
        input_tokens = 0
        output_tokens = 0
        if not payload.stream:
            input_tokens, output_tokens = _response_usage(response)

        if payload.stream:
            result = await executor._stream_response(
                executor._guard_stream(response, routing_result),
                client_has_tools=client_has_tools,
                on_complete=lambda usage, ok: _record_stream_usage(
                    executor, pool, routing_result, payload, usage, ok, outcome,
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

        # success only after first chunk, else failure window is cleared
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
                    upstream_model_id=routing_result.upstream_model.id,
                    error=None,
                    http_status=200,
                )
            await run_in_session(_record_success)
        except Exception:
            logger.warning("Failed to record gateway success to routing engine", exc_info=True)

        if not payload.stream:
            outcome.input_tokens = input_tokens
            outcome.output_tokens = output_tokens
            outcome.ok = True
            outcome.routing_result = routing_result

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
        classified = routing_result.adapter.classify_error(exc)
        outcome.routing_result = routing_result
        outcome.ok = False
        outcome.error_class = getattr(classified, "category", type(exc).__name__)
        try:
            async def _record_failure(session):
                await executor._routing_engine.record_result(
                    session,
                    credential_id=routing_result.credential.id,
                    endpoint_id=routing_result.endpoint.id,
                    upstream_model_id=routing_result.upstream_model.id,
                    error=classified,
                    http_status=None,
                )
            await run_in_session(_record_failure)
        except Exception:
            logger.warning("Failed to record gateway failure to routing engine", exc_info=True)
        raise
