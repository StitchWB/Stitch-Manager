from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import TYPE_CHECKING, Any, cast

from fastapi import HTTPException

from stitch_backend.core.event_bus import event_bus
from stitch_backend.domains.ai_gateway import account_ledger
from stitch_backend.domains.ai_gateway.adapters.error_vocab import parse_envelope
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error
from stitch_backend.domains.ai_proxy.holone_inspector import (
    default_engine as _holone_default_engine,
)
from stitch_backend.domains.ai_proxy.litellm_response_parsing import _json_object, _usage_split
from stitch_backend.domains.ai_proxy.litellm_streaming import (
    StreamStallError,
    TtftWatchdogError,
)
from stitch_backend.domains.ai_proxy.request_logs import RequestLogFailureMetadata

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
        "model", "provider", "messages", "input", "stream", "base_url", "secret",
        "default_headers", "max_wait_seconds",
    })


class EmptyCompletionError(RuntimeError):
    """Upstream answered HTTP 200 but the completion carries no usable content.

    Distinct type so the failure pipeline can classify it as a model-level
    retryable failure instead of letting the adapter guess from the message
    text (which lands on ``unknown`` and miscounts toward the endpoint
    breaker).
    """


class LatencyPolicy:
    """Parsed ``contract.latency`` of a public model.

    Contract keys (all optional; absent or wrong-typed values disable the
    corresponding guard)::

        contract: {
          "latency": {
            "maxTtftMs": 20000,      # budget from upstream request start to
                                     # the first *meaningful* frame (stream) or
                                     # the completed response (non-stream)
            "stallTimeoutMs": 30000  # max silence between stream frames;
                                     # also bounds a totally silent stream
          }
        }
    """

    def __init__(self, max_ttft_ms: float | None, stall_timeout_ms: float | None) -> None:
        self.max_ttft_ms = max_ttft_ms
        self.stall_timeout_ms = stall_timeout_ms

    def ttft_seconds(self) -> float | None:
        return self.max_ttft_ms / 1000.0 if self.max_ttft_ms is not None else None

    def stall_seconds(self) -> float | None:
        return self.stall_timeout_ms / 1000.0 if self.stall_timeout_ms is not None else None


def _positive_ms(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if value <= 0:
        return None
    return float(value)


def parse_latency_policy(contract: Any) -> LatencyPolicy | None:
    """Defensively parse the ``latency`` object of a public-model contract.

    Anything absent or wrong-typed yields ``None`` — no watchdog.  The
    feature is strictly opt-in per public model.
    """
    if not isinstance(contract, dict):
        return None
    latency = contract.get("latency")
    if not isinstance(latency, dict):
        return None
    ttft = _positive_ms(latency.get("maxTtftMs"))
    stall = _positive_ms(latency.get("stallTimeoutMs"))
    if ttft is None and stall is None:
        return None
    return LatencyPolicy(ttft, stall)


_LATENCY_CACHE_TTL_S = 30.0
_latency_cache: dict[str, tuple[float, LatencyPolicy | None]] = {}


async def load_latency_policy(
    model: str | None,
    run_in_session: Callable[..., Awaitable[Any]],
) -> LatencyPolicy | None:
    """Load the latency policy for a public model, cached for 30s.

    The routing engine already reads the contract but does not expose it on
    ``RoutingResult``; rather than widening that contract we re-read the row
    here through a small TTL cache.  Any failure (DB down, row missing,
    malformed contract) disables the watchdog — never the request.
    """
    if not model:
        return None
    now = time.monotonic()
    cached = _latency_cache.get(model)
    if cached is not None and now - cached[0] < _LATENCY_CACHE_TTL_S:
        return cached[1]
    policy: LatencyPolicy | None = None
    try:
        from stitch_backend.domains.ai_gateway.model_catalog_service import (
            PublicModelService,
        )

        async def _query(session):
            public_model = await PublicModelService(session).get_by_pk(model)
            return getattr(public_model, "contract", None) if public_model is not None else None

        policy = parse_latency_policy(await run_in_session(_query))
    except Exception:
        logger.debug("Latency policy load failed for %s", model, exc_info=True)
        policy = None
    _latency_cache[model] = (now, policy)
    return policy


def _reset_latency_cache() -> None:
    """Test hook: drop cached latency policies."""
    _latency_cache.clear()


async def _await_with_ttft_watchdog(coro: Any, timeout_s: float) -> Any:
    """Await a non-stream upstream invoke under the TTFT budget.

    Non-streaming adapters buffer the whole body, so the watchdog fires on
    total elapsed time — an accepted approximation (a non-stream response is
    silent until generation completes anyway, and aborting is always safe for
    the client because no byte was ever sent).  Operators should size
    ``maxTtftMs`` for non-stream roles with generation time in mind.
    """
    try:
        return await asyncio.wait_for(coro, timeout_s)
    except TimeoutError as exc:
        raise TtftWatchdogError(
            f"upstream response did not complete within {timeout_s:.2f}s"
        ) from exc


def _is_passive_slowness(exc: BaseException) -> bool:
    """True for watchdog/stall aborts: slow ≠ dead, never a health failure."""
    return isinstance(exc, (TtftWatchdogError, StreamStallError))


async def _emit_slowness_event(kind: str, routing_result: Any, payload_model: str | None) -> None:
    try:
        await event_bus.emit(
            f"gateway.request.{kind}",
            {
                "model": payload_model or "",
                "upstream_model": getattr(
                    getattr(routing_result, "upstream_model", None), "upstream_model_id", "",
                ),
                "endpoint_id": getattr(getattr(routing_result, "endpoint", None), "id", ""),
                "credential_id": getattr(
                    getattr(routing_result, "credential", None), "id", "",
                )[:8],
            },
        )
    except Exception:
        logger.debug("Failed to emit %s event", kind, exc_info=True)


class UpstreamErrorEnvelopeError(RuntimeError):
    """Upstream answered HTTP 200 with a top-level ``{\"error\": ...}`` body.

    Some OpenAI-compatible gateways incorrectly transport failures as a
    successful HTTP response.  Raising here re-enters the normal failure
    pipeline; the exception text is the original JSON body so the adapter's
    machine-readable error-vocabulary classifier can attribute scope correctly.
    """

    def __init__(self, envelope: dict[str, Any]) -> None:
        self.envelope = envelope
        super().__init__(json.dumps(envelope, ensure_ascii=False, separators=(",", ":")))


def _choice_is_empty(choice: Any) -> bool:
    """True when a chat-completion choice carries no content at all.

    Empty means: no content, no tool_calls, no reasoning content.  A
    tool-call-only reply is a legitimate answer and is NOT empty.
    """
    if not isinstance(choice, dict):
        return False
    message = choice.get("message")
    if not isinstance(message, dict):
        # Non-message shapes (text completions, deltas already materialized)
        # fall back to the choice-level text field.
        text = choice.get("text")
        return isinstance(text, str) and not text
    content = message.get("content")
    if isinstance(content, str) and content:
        return False
    if isinstance(content, list) and content:
        return False
    if message.get("tool_calls"):
        return False
    if message.get("reasoning_content"):
        return False
    if message.get("reasoning"):
        return False
    return True


def _reject_empty_completion(result: Any) -> None:
    """Reject invalid HTTP-200 upstream bodies before they can count as success.

    Error envelopes are checked first: a 200 carrying ``error`` is a failure
    even when it also has empty/no completion fields.  The normal empty-body
    validation then catches successful envelopes with no usable content.
    """
    if not isinstance(result, dict):
        return
    if result.get("error") is not None:
        raise UpstreamErrorEnvelopeError(result)
    choices = result.get("choices")
    if isinstance(choices, list):
        if not choices:
            raise EmptyCompletionError("upstream returned an empty completion")
        # deepseek-v4-pro shape: choices exist but every message is empty.
        if all(_choice_is_empty(choice) for choice in choices):
            raise EmptyCompletionError("upstream returned an empty completion")
    output = result.get("output")
    if isinstance(output, list) and not output and "object" in result:
        raise EmptyCompletionError("upstream returned an empty completion")
    content = result.get("content")
    if isinstance(content, list) and not content and "stop_reason" in result:
        raise EmptyCompletionError("upstream returned an empty completion")


def _classify_invoke_failure(
    adapter: Any,
    exc: BaseException,
    *,
    http_status: int | None = None,
) -> Any:
    """Classify an invoke failure, honouring pipeline-raised error types.

    ``EmptyCompletionError`` is a model-level retryable failure: the endpoint
    answered 200 (so the endpoint and the key are both healthy) but this one
    model produced nothing usable.  ``is_model_specific`` routes it to
    ``CredentialModelAccess`` in ``record_result`` and keeps it out of both
    the credential state machine and the endpoint circuit breaker.
    """
    from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError

    if isinstance(exc, TtftWatchdogError):
        # Slowness, not death: model-level retryable, key-scoped so the
        # failover walk simply advances to the next candidate.  Nothing is
        # written to health state for this class of failure.
        return ClassifiedError(
            category="server_error",
            is_endpoint_wide=False,
            is_model_specific=True,
            scope="key",
            error_code="ttft_watchdog",
        )
    if isinstance(exc, StreamStallError):
        return ClassifiedError(
            category="server_error",
            is_endpoint_wide=False,
            is_model_specific=True,
            scope="key",
            error_code="stream_stall",
        )
    if isinstance(exc, EmptyCompletionError):
        return ClassifiedError(
            category="server_error",
            is_endpoint_wide=False,
            is_model_specific=True,
            scope="key",
        )
    if http_status is not None:
        return adapter.classify_error(exc, http_status=http_status)
    return adapter.classify_error(exc)


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


def _failure_metadata(classified: Any, exc: BaseException) -> RequestLogFailureMetadata:
    response = getattr(exc, "response", None)
    body_text = ""
    if response is not None:
        try:
            body_text = response.text
        except Exception:  # noqa: BLE001
            body_text = ""
    elif isinstance(exc, UpstreamErrorEnvelopeError):
        body_text = str(exc)
    envelope = parse_envelope(body_text)
    return RequestLogFailureMetadata(
        getattr(classified, "category", type(exc).__name__),
        error_code=getattr(classified, "error_code", None),
        outcome_confirmed=getattr(classified, "outcome_confirmed", None),
        gateway_attempts=getattr(classified, "gateway_attempts", None),
        upstream_request_id=envelope.request_id if envelope else None,
    )


def _cached_tokens(response: Any) -> int:
    usage = response.get("usage") if isinstance(response, dict) else getattr(response, "usage", None)
    if isinstance(usage, dict):
        details = usage.get("prompt_tokens_details")
        value = details.get("cached_tokens") if isinstance(details, dict) else None
    else:
        details = getattr(usage, "prompt_tokens_details", None)
        value = getattr(details, "cached_tokens", None)
    if isinstance(value, int) and not isinstance(value, bool):
        return max(0, value)
    return 0


async def _resolve_latency_policy(
    routing_result: Any,
    model: str | None,
    run_in_session: Callable[..., Awaitable[Any]],
) -> LatencyPolicy | None:
    """Latency policy for one invoke, preferring routing-carried contract data.

    ``RoutingResult.public_model_contract`` is authoritative and avoids the
    redundant database re-read.  Candidates built outside routing (contract
    attribute absent or None) fall back to the TTL-cache loader.
    """
    contract = getattr(routing_result, "public_model_contract", None)
    if contract is not None:
        return parse_latency_policy(contract)
    return await load_latency_policy(model, run_in_session)


async def _record_ledger_usage(
    run_in_session: Callable[..., Awaitable[Any]],
    routing_result: Any,
    input_tokens: int,
    output_tokens: int,
    cached_tokens: int = 0,
) -> None:
    try:
        endpoint_id = routing_result.endpoint.id
        account_group = getattr(routing_result.credential, "account_group", None)

        async def _write(session):
            await account_ledger.record_usage(
                session,
                endpoint_id=endpoint_id,
                account_group=account_group,
                requests=1,
                tokens_in=input_tokens,
                tokens_out=output_tokens,
                cached_tokens=cached_tokens,
            )

        await run_in_session(_write)
    except Exception:
        logger.debug("Account ledger write failed", exc_info=True)


def _remember_affinity(payload: GatewayRequest, routing_result: Any) -> None:
    try:
        account_ledger.put_affinity(
            payload.model or "",
            payload.messages or [],
            getattr(payload, "user", None),
            routing_result.endpoint.id,
            getattr(routing_result.credential, "account_group", None),
        )
    except Exception:
        logger.debug("Affinity write failed", exc_info=True)


async def _record_stream_usage(
    executor: LiteLLMExecutor,
    pool: PoolScope | None,
    routing_result: Any,
    payload: GatewayRequest,
    usage: tuple[int, int] | None,
    ok: bool,
    outcome: _RequestOutcome,
    *,
    run_in_session: Callable[..., Awaitable[Any]],
    failure_reason: str | None = None,
) -> None:
    input_tokens, output_tokens = usage if usage is not None else (0, 0)
    await executor._record_group_usage_for(
        pool, routing_result, payload.model, input_tokens + output_tokens,
    )
    await _record_ledger_usage(
        run_in_session, routing_result, input_tokens, output_tokens,
    )
    outcome.input_tokens = input_tokens
    outcome.output_tokens = output_tokens
    outcome.ok = ok
    outcome.routing_result = routing_result
    outcome.error_class = None if ok else (failure_reason or "stream_interrupted")
    if not ok and failure_reason == "empty_completion":
        # A role/metadata-only stream is the streaming form of an empty
        # completion.  Bytes may already have reached the client, so failover
        # is impossible here, but health attribution must still be model-level
        # rather than a generic transport failure or, worse, a success.
        classified = _classify_invoke_failure(
            routing_result.adapter,
            EmptyCompletionError("upstream returned an empty completion"),
        )
        try:
            async def _record_empty_stream(session):
                await executor._routing_engine.record_result(
                    session,
                    credential_id=routing_result.credential.id,
                    endpoint_id=routing_result.endpoint.id,
                    upstream_model_id=routing_result.upstream_model.id,
                    error=classified,
                    http_status=200,
                    probe_lease=getattr(routing_result, "probe_lease", None),
                )
            await run_in_session(_record_empty_stream)
        except Exception:
            logger.warning("Failed to record empty stream to routing engine", exc_info=True)
    await executor._persist_outcome(outcome)


def _stream_usage_callback(
    executor: LiteLLMExecutor,
    pool: PoolScope | None,
    routing_result: Any,
    payload: GatewayRequest,
    outcome: _RequestOutcome,
    *,
    run_in_session: Callable[..., Awaitable[Any]],
) -> Callable[..., Awaitable[None]]:
    """Build the three-argument stream-completion callback for one invoke."""
    async def _callback(
        usage: tuple[int, int] | None,
        ok: bool,
        failure_reason: str | None = None,
    ) -> None:
        await _record_stream_usage(
            executor,
            pool,
            routing_result,
            payload,
            usage,
            ok,
            outcome,
            run_in_session=run_in_session,
            failure_reason=failure_reason,
        )

    return _callback


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
    latency_policy = await _resolve_latency_policy(routing_result, payload.model, run_in_session)
    ttft_budget = latency_policy.ttft_seconds() if latency_policy is not None else None
    stall_budget = latency_policy.stall_seconds() if latency_policy is not None else None

    try:
        invoke_coro = routing_result.adapter.invoke(
            base_url=routing_result.endpoint.base_url,
            secret=routing_result.secret,
            model=routing_result.upstream_model.upstream_model_id,
            messages=messages,
            stream=payload.stream,
            default_headers=routing_result.default_headers,
            **_adapter_options(payload),
        )
        if ttft_budget is not None and not payload.stream:
            response = await _await_with_ttft_watchdog(invoke_coro, ttft_budget)
        else:
            response = await invoke_coro

        latency = time.time() - start_time

        # Extract tokens from response (if available)
        input_tokens = 0
        output_tokens = 0
        if not payload.stream:
            input_tokens, output_tokens = _response_usage(response)

        if payload.stream:
            ttft_remaining = (
                max(ttft_budget - (time.time() - start_time), 0.001)
                if ttft_budget is not None
                else None
            )
            result = await executor._stream_response(
                executor._guard_stream(response, routing_result, stall_timeout=stall_budget),
                client_has_tools=client_has_tools,
                on_complete=_stream_usage_callback(
                    executor,
                    pool,
                    routing_result,
                    payload,
                    outcome,
                    run_in_session=run_in_session,
                ),
                model=payload.model,
                routing_result=routing_result,
                request_started_at=start_time,
                ttft_timeout=ttft_remaining,
            )
        else:
            result = cast("Any", _json_object(response))
            _reject_empty_completion(result)
            if holone_service.config.enabled:
                result, findings, blocked = holone_service.inspect_response_openai(
                    result, client_has_tools=client_has_tools
                )
                if findings:
                    logger.info("HoloNe findings: %s (blocked=%s)", [f.rule_id for f in findings], blocked)
            await executor._record_group_usage_for(
                pool, routing_result, payload.model, input_tokens + output_tokens,
            )

        if not payload.stream:
            await _record_ledger_usage(
                run_in_session,
                routing_result,
                input_tokens,
                output_tokens,
                _cached_tokens(response),
            )
        _remember_affinity(payload, routing_result)

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
                    probe_lease=getattr(routing_result, "probe_lease", None),
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
        classified = _classify_invoke_failure(routing_result.adapter, exc)
        outcome.routing_result = routing_result
        outcome.ok = False
        outcome.error_class = _failure_metadata(classified, exc)
        if _is_passive_slowness(exc):
            # Slowness is not death: a watchdog/stall abort must not mark
            # CredentialModelAccess temporarily_unavailable, must not count
            # toward credential consecutive_failures and must not feed the
            # endpoint circuit breaker.  Failover + trace event only; the
            # rolling-metrics latency observability is a later-phase
            # integration point (latency-aware ordering / lifecycle demotion).
            logger.warning(
                "Gateway %s abort for %s (credential=%s) — slow upstream, failing over",
                type(exc).__name__,
                routing_result.upstream_model.upstream_model_id,
                routing_result.credential.id[:8],
            )
            await _emit_slowness_event(
                "ttft_watchdog" if isinstance(exc, TtftWatchdogError) else "stream_stall",
                routing_result,
                payload.model,
            )
            raise
        try:
            async def _record_failure(session):
                await executor._routing_engine.record_result(
                    session,
                    credential_id=routing_result.credential.id,
                    endpoint_id=routing_result.endpoint.id,
                    upstream_model_id=routing_result.upstream_model.id,
                    error=classified,
                    http_status=None,
                    probe_lease=getattr(routing_result, "probe_lease", None),
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
    latency_policy = await _resolve_latency_policy(routing_result, payload.model, run_in_session)
    ttft_budget = latency_policy.ttft_seconds() if latency_policy is not None else None
    stall_budget = latency_policy.stall_seconds() if latency_policy is not None else None

    try:
        invoke = getattr(routing_result.adapter, "invoke_messages", routing_result.adapter.invoke)
        invoke_coro = invoke(
            base_url=routing_result.endpoint.base_url,
            secret=routing_result.secret,
            model=routing_result.upstream_model.upstream_model_id,
            messages=messages,
            stream=payload.stream,
            default_headers=routing_result.default_headers,
            **_adapter_options(payload),
        )
        if ttft_budget is not None and not payload.stream:
            response = await _await_with_ttft_watchdog(invoke_coro, ttft_budget)
        else:
            response = await invoke_coro

        latency = time.time() - start_time

        # Extract tokens from response (if available)
        input_tokens = 0
        output_tokens = 0
        if not payload.stream:
            input_tokens, output_tokens = _response_usage(response)

        if payload.stream:
            ttft_remaining = (
                max(ttft_budget - (time.time() - start_time), 0.001)
                if ttft_budget is not None
                else None
            )
            result = await executor._stream_anthropic_response(
                executor._guard_stream(response, routing_result, stall_timeout=stall_budget),
                client_has_tools=client_has_tools,
                on_complete=_stream_usage_callback(
                    executor,
                    pool,
                    routing_result,
                    payload,
                    outcome,
                    run_in_session=run_in_session,
                ),
                model=payload.model,
                routing_result=routing_result,
                request_started_at=start_time,
                ttft_timeout=ttft_remaining,
            )
        else:
            result = cast("Any", _json_object(response))
            _reject_empty_completion(result)
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

        if not payload.stream:
            await _record_ledger_usage(
                run_in_session,
                routing_result,
                input_tokens,
                output_tokens,
                _cached_tokens(response),
            )
        _remember_affinity(payload, routing_result)

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
                    probe_lease=getattr(routing_result, "probe_lease", None),
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
        classified = _classify_invoke_failure(routing_result.adapter, exc)
        outcome.routing_result = routing_result
        outcome.ok = False
        outcome.error_class = _failure_metadata(classified, exc)
        if _is_passive_slowness(exc):
            # Slowness is not death: a watchdog/stall abort must not mark
            # CredentialModelAccess temporarily_unavailable, must not count
            # toward credential consecutive_failures and must not feed the
            # endpoint circuit breaker.  Failover + trace event only; the
            # rolling-metrics latency observability is a later-phase
            # integration point (latency-aware ordering / lifecycle demotion).
            logger.warning(
                "Gateway %s abort for %s (credential=%s) — slow upstream, failing over",
                type(exc).__name__,
                routing_result.upstream_model.upstream_model_id,
                routing_result.credential.id[:8],
            )
            await _emit_slowness_event(
                "ttft_watchdog" if isinstance(exc, TtftWatchdogError) else "stream_stall",
                routing_result,
                payload.model,
            )
            raise
        try:
            async def _record_failure(session):
                await executor._routing_engine.record_result(
                    session,
                    credential_id=routing_result.credential.id,
                    endpoint_id=routing_result.endpoint.id,
                    upstream_model_id=routing_result.upstream_model.id,
                    error=classified,
                    http_status=None,
                    probe_lease=getattr(routing_result, "probe_lease", None),
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
    latency_policy = await _resolve_latency_policy(routing_result, payload.model, run_in_session)
    ttft_budget = latency_policy.ttft_seconds() if latency_policy is not None else None
    stall_budget = latency_policy.stall_seconds() if latency_policy is not None else None

    try:
        invoke_coro = routing_result.adapter.invoke_responses(
            base_url=routing_result.endpoint.base_url,
            secret=routing_result.secret,
            model=routing_result.upstream_model.upstream_model_id,
            input=input_data,
            stream=payload.stream,
            default_headers=routing_result.default_headers,
            **_adapter_options(payload),
        )
        if ttft_budget is not None and not payload.stream:
            response = await _await_with_ttft_watchdog(invoke_coro, ttft_budget)
        else:
            response = await invoke_coro

        latency = time.time() - start_time

        # Extract tokens from response (if available)
        input_tokens = 0
        output_tokens = 0
        if not payload.stream:
            input_tokens, output_tokens = _response_usage(response)

        if payload.stream:
            ttft_remaining = (
                max(ttft_budget - (time.time() - start_time), 0.001)
                if ttft_budget is not None
                else None
            )
            result = await executor._stream_response(
                executor._guard_stream(response, routing_result, stall_timeout=stall_budget),
                client_has_tools=client_has_tools,
                on_complete=_stream_usage_callback(
                    executor,
                    pool,
                    routing_result,
                    payload,
                    outcome,
                    run_in_session=run_in_session,
                ),
                model=payload.model,
                routing_result=routing_result,
                request_started_at=start_time,
                ttft_timeout=ttft_remaining,
            )
        else:
            result = cast("Any", _json_object(response))
            _reject_empty_completion(result)
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

        if not payload.stream:
            await _record_ledger_usage(
                run_in_session,
                routing_result,
                input_tokens,
                output_tokens,
                _cached_tokens(response),
            )
        _remember_affinity(payload, routing_result)

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
                    probe_lease=getattr(routing_result, "probe_lease", None),
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
        classified = _classify_invoke_failure(routing_result.adapter, exc)
        outcome.routing_result = routing_result
        outcome.ok = False
        outcome.error_class = _failure_metadata(classified, exc)
        if _is_passive_slowness(exc):
            # Slowness is not death: a watchdog/stall abort must not mark
            # CredentialModelAccess temporarily_unavailable, must not count
            # toward credential consecutive_failures and must not feed the
            # endpoint circuit breaker.  Failover + trace event only; the
            # rolling-metrics latency observability is a later-phase
            # integration point (latency-aware ordering / lifecycle demotion).
            logger.warning(
                "Gateway %s abort for %s (credential=%s) — slow upstream, failing over",
                type(exc).__name__,
                routing_result.upstream_model.upstream_model_id,
                routing_result.credential.id[:8],
            )
            await _emit_slowness_event(
                "ttft_watchdog" if isinstance(exc, TtftWatchdogError) else "stream_stall",
                routing_result,
                payload.model,
            )
            raise
        try:
            async def _record_failure(session):
                await executor._routing_engine.record_result(
                    session,
                    credential_id=routing_result.credential.id,
                    endpoint_id=routing_result.endpoint.id,
                    upstream_model_id=routing_result.upstream_model.id,
                    error=classified,
                    http_status=None,
                    probe_lease=getattr(routing_result, "probe_lease", None),
                )
            await run_in_session(_record_failure)
        except Exception:
            logger.warning("Failed to record gateway failure to routing engine", exc_info=True)
        raise
