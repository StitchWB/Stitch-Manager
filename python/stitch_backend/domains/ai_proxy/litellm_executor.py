from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any, Protocol, cast

from fastapi import HTTPException
from sqlalchemy import exc as sqlalchemy_exc

from stitch_backend.core.event_bus import event_bus
from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway import circuit_breaker
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error
from stitch_backend.domains.ai_gateway.routing_engine import (
    ContextLengthExceededError,
    PoolScope,
    QuotaExceededError,
    RoutingEngine,
    RoutingError,
    UpstreamFailureError,
)
from stitch_backend.domains.ai_gateway.routing_engine import GatewayRequest as AIGatewayRequest
from stitch_backend.domains.ai_gateway.usage_tracker import record_usage as _record_group_usage
from stitch_backend.domains.ai_proxy.compression.service import get_compression_service
from stitch_backend.domains.ai_proxy.cost_tracker import get_cost_tracker
from stitch_backend.domains.ai_proxy.holone_service import get_holone_service
from stitch_backend.domains.ai_proxy.key_metrics import get_metrics_tracker
from stitch_backend.domains.ai_proxy.litellm_errors import is_managed_routing_error
from stitch_backend.domains.ai_proxy.litellm_invoke_pipeline import (
    invoke_via_gateway,
    invoke_via_gateway_messages,
    invoke_via_gateway_responses,
)
from stitch_backend.domains.ai_proxy.litellm_public_models import (
    ConfigLoader,
    _default_config,
    _public_models_auto_created,
    auto_create_public_models_from_config,
)
from stitch_backend.domains.ai_proxy.litellm_streaming import (
    prime_stream,
    stream_anthropic_response,
    stream_anthropic_response_buffered,
    stream_openai_response,
    stream_openai_response_buffered,
)
from stitch_backend.domains.ai_proxy.request_trace import (
    RequestTrace,
    get_request_trace_store,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from fastapi.responses import StreamingResponse
    from pydantic import BaseModel
    from starlette.responses import Response

    from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError
    from stitch_backend.domains.ai_proxy.litellm_gateway import (
        GatewayRequest,
        JsonObject,
        JsonValue,
    )
    from stitch_backend.domains.background_manager.schemas import BackgroundManagerConfig

logger = logging.getLogger(__name__)

__all__ = [
    "CompletionRouter",
    "ConfigLoader",
    "LiteLLMExecutor",
    "_public_models_auto_created",
    "auto_create_public_models_from_config",
]


_STATUS_BY_CATEGORY: dict[str, int] = {
    "quota_exhausted": 429,
    "rate_limited": 429,
    "auth_failed": 502,
    "model_not_found": 404,
    "model_access_denied": 403,
    "client_error": 400,
    "server_error": 502,
    "transport_error": 503,
}

_FAILURE_MESSAGES: dict[str, str] = {
    "quota_exhausted": "All providers for model '{model}' are out of quota. Retry later.",
    "rate_limited": "All providers for model '{model}' are rate-limited. Retry shortly.",
    "auth_failed": "All providers for model '{model}' rejected authentication.",
    "model_not_found": "Model '{model}' is not available on any configured provider.",
    "model_access_denied": "No configured provider grants access to model '{model}'.",
    "client_error": "Every provider rejected the request for model '{model}'.",
    "server_error": "All providers for model '{model}' are temporarily unavailable.",
    "transport_error": "All providers for model '{model}' are unreachable.",
}


def _status_for_category(category: str) -> int:
    return _STATUS_BY_CATEGORY.get(category, 502)


def _canonical_failure_message(model: str, category: str) -> str:
    template = _FAILURE_MESSAGES.get(category, "No provider could serve model '{model}'.")
    return template.format(model=model)


def _is_client_error(exc: HTTPException) -> bool:
    status = exc.status_code
    return 400 <= status < 500 and status != 429


class CompletionRouter(Protocol):
    """Structural protocol for a LiteLLM-compatible completion router.

    Documentation anchor for the adapter seam (see ``ai_gateway/adapters/base.py``).
    All routing goes through the AI Gateway :class:`RoutingEngine`.
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


class LiteLLMExecutor:
    """AI Gateway routing executor.

    All request routing goes through the AI Gateway :class:`RoutingEngine`.
    Owns: cost tracker, holone, compression, adapters, circuit breaker,
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
                response_format=getattr(payload, "response_format", None),
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
        except QuotaExceededError as e:
            logger.info("Group quota exceeded for %s: %s", payload.model, e)
            raise
        except RoutingError as e:
            if is_managed_routing_error(e):
                raise
            logger.debug("AI Gateway route unavailable for %s: %s", payload.model, e)
            return None
        except Exception as e:
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

    def _record_request_trace(
        self,
        *,
        model: str | None,
        routing_result: Any | None,
        latency_ms: float,
        failover_count: int,
        status: str,
    ) -> None:
        if routing_result is None:
            return
        endpoint = routing_result.endpoint
        get_request_trace_store().record(
            RequestTrace(
                model=model or "",
                target=getattr(endpoint, "name", None) or endpoint.id,
                credential_id=routing_result.credential.id,
                latency_ms=latency_ms,
                failover_count=failover_count,
                status=status,
                timestamp=time.time(),
            )
        )

    def _model_chain(self, primary: str) -> list[str]:
        """Ordered models to attempt: the requested one, then the fallback chain."""
        from stitch_backend.config import get_settings

        settings = get_settings()
        if not getattr(settings, "ai_gateway_fallback_enabled", False):
            return [primary]
        raw = getattr(settings, "ai_gateway_fallback_models", "") or ""
        chain = [m.strip() for m in raw.split(",") if m.strip()]
        return [primary, *(m for m in chain if m != primary)]

    async def _emit_failover_event(
        self,
        *,
        requested: str,
        served: str,
        routing_result: Any,
        failover_count: int,
        used_fallback: bool,
    ) -> None:
        if failover_count == 0 and not used_fallback:
            return
        try:
            await event_bus.emit(
                "gateway.request.failover",
                {
                    "requested_model": requested,
                    "served_model": served,
                    "target": getattr(routing_result.endpoint, "name", None)
                    or routing_result.endpoint.id,
                    "credential_id": routing_result.credential.id[:8],
                    "attempts": failover_count,
                    "used_fallback": used_fallback,
                },
            )
        except Exception:
            logger.debug("Failed to emit failover event", exc_info=True)

    def _final_error(
        self,
        model: str,
        last_classified: ClassifiedError | None,
        last_routing_error: RoutingError | None,
    ) -> RoutingError:
        if last_classified is not None:
            return UpstreamFailureError(
                _canonical_failure_message(model, last_classified.category),
                reason=last_classified.category,
                status_code=_status_for_category(last_classified.category),
            )
        if last_routing_error is not None:
            return last_routing_error
        return UpstreamFailureError(
            f"No route available for model: {model}",
            reason="no_route",
            status_code=503,
        )

    async def _run_failover(
        self,
        payload: GatewayRequest,
        config: BackgroundManagerConfig,
        invoke: Callable[[Any], Awaitable[JsonObject | Response]],
        pool: PoolScope | None = None,
    ) -> JsonObject | Response:
        """Walk candidate models and credentials until one succeeds.

        On total failure raises a canonical :class:`RoutingError` (never a raw
        upstream error), so the HTTP layer answers with one stable envelope.
        """
        requested_model = payload.model or ""
        start_time = time.time()
        failed_attempts = 0
        last_attempted: Any | None = None
        last_classified: ClassifiedError | None = None
        last_routing_error: RoutingError | None = None
        served_model = requested_model

        for model_index, model in enumerate(self._model_chain(requested_model)):
            route_payload = (
                payload
                if model == requested_model
                else payload.model_copy(update={"model": model})
            )
            try:
                routing_results = await self._try_ai_gateway_route(route_payload, pool=pool)
            except (QuotaExceededError, ContextLengthExceededError):
                raise
            except RoutingError as exc:
                last_routing_error = exc
                continue
            if routing_results is None:
                continue

            for routing_result in routing_results:
                if not await self._is_endpoint_available(routing_result.endpoint.id):
                    logger.debug(
                        "Skipping candidate on endpoint %s — circuit open",
                        routing_result.endpoint.id,
                    )
                    continue
                last_attempted = routing_result
                try:
                    result = await invoke(routing_result)
                except HTTPException as e:
                    if _is_client_error(e):
                        raise
                    failed_attempts += 1
                    last_classified = routing_result.adapter.classify_error(
                        e, http_status=e.status_code,
                    )
                    logger.warning(
                        "AI Gateway invoke failed for %s (credential=%s): %s — trying next candidate",
                        model, routing_result.credential.id[:8],
                        _sanitize_error(e, secret=routing_result.secret),
                    )
                    continue
                except Exception as e:
                    failed_attempts += 1
                    last_classified = routing_result.adapter.classify_error(e)
                    logger.warning(
                        "AI Gateway invoke failed for %s (credential=%s): %s — trying next candidate",
                        model, routing_result.credential.id[:8],
                        _sanitize_error(e, secret=routing_result.secret),
                    )
                    continue
                served_model = model
                self._record_request_trace(
                    model=model,
                    routing_result=routing_result,
                    latency_ms=(time.time() - start_time) * 1000.0,
                    failover_count=failed_attempts,
                    status="success",
                )
                await self._emit_failover_event(
                    requested=requested_model,
                    served=served_model,
                    routing_result=routing_result,
                    failover_count=failed_attempts,
                    used_fallback=model_index > 0,
                )
                return result

        self._record_request_trace(
            model=served_model,
            routing_result=last_attempted,
            latency_ms=(time.time() - start_time) * 1000.0,
            failover_count=failed_attempts,
            status="error",
        )
        raise self._final_error(requested_model, last_classified, last_routing_error)

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
        return await self._run_failover(
            payload,
            config,
            lambda routing_result: self._invoke_via_gateway(payload, routing_result, config, pool=pool),
            pool=pool,
        )

    async def _invoke_via_gateway(
        self, payload: GatewayRequest, routing_result: Any, config: BackgroundManagerConfig,
        pool: PoolScope | None = None,
    ) -> JsonObject | Response:
        """Invoke upstream via AI Gateway routing result."""
        return await invoke_via_gateway(
            self, payload, routing_result, config, pool,
            get_metrics_tracker=get_metrics_tracker,
            get_cost_tracker=get_cost_tracker,
            run_in_session=run_in_session,
        )

    async def messages(self, payload: GatewayRequest, pool: PoolScope | None = None) -> JsonObject | Response:
        config = await self._load_config()
        return await self._run_failover(
            payload,
            config,
            lambda routing_result: self._invoke_via_gateway_messages(payload, routing_result, config, pool=pool),
            pool=pool,
        )

    async def _invoke_via_gateway_messages(
        self, payload: GatewayRequest, routing_result: Any, config: BackgroundManagerConfig,
        pool: PoolScope | None = None,
    ) -> JsonObject | Response:
        """Invoke upstream via AI Gateway routing result (Anthropic Messages API)."""
        return await invoke_via_gateway_messages(
            self, payload, routing_result, config, pool,
            get_metrics_tracker=get_metrics_tracker,
            get_cost_tracker=get_cost_tracker,
            run_in_session=run_in_session,
        )

    async def responses(self, payload: GatewayRequest, pool: PoolScope | None = None) -> JsonObject | Response:
        config = await self._load_config()
        return await self._run_failover(
            payload,
            config,
            lambda routing_result: self._invoke_via_gateway_responses(payload, routing_result, config, pool=pool),
            pool=pool,
        )

    async def _invoke_via_gateway_responses(
        self, payload: GatewayRequest, routing_result: Any, config: BackgroundManagerConfig,
        pool: PoolScope | None = None,
    ) -> JsonObject | Response:
        """Invoke upstream via AI Gateway routing result (Responses API)."""
        return await invoke_via_gateway_responses(
            self, payload, routing_result, config, pool,
            get_metrics_tracker=get_metrics_tracker,
            get_cost_tracker=get_cost_tracker,
            run_in_session=run_in_session,
        )

    async def models(self, pool: PoolScope | None = None) -> JsonObject:
        """Return available models from the AI Gateway PublicModel catalog.

        The gateway PublicModel table is the sole source of model listings;
        the startup :func:`auto_create_public_models_from_config` step
        populates it from BackgroundManagerConfig providers.
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

    async def _record_group_usage_for(
        self,
        pool: PoolScope | None,
        routing_result: Any,
        model: str | None,
        tokens: int | None,
    ) -> None:
        """Record group usage for a successful request (no-op for desktop)."""
        if pool is None or pool.owner_user_id is None:
            return
        await _record_group_usage(
            pool.owner_user_id,
            routing_result.group_id_hit,
            model=model,
            tokens=tokens,
        )

    async def _guard_stream(self, stream: Any, routing_result: Any) -> Any:
        """Wrap an upstream SSE iterator: on mid-stream failure, mark the
        credential/endpoint, then abort the client stream.

        Pass-through streaming cannot retry after bytes were sent, so the
        only correct response to a mid-flight upstream error is to record
        it (cooldown/circuit breaker) and propagate.  A failure before the
        first line is left to the invoke pipeline, which can still fail
        over to the next candidate.
        """
        started = False
        try:
            async for line in stream:
                started = True
                yield line
        except Exception as exc:
            if not started:
                raise
            captured = exc  # capture for closure — PEP 3110 deletes `exc` after except block
            logger.warning(
                "Upstream stream failed mid-flight (credential=%s): %s",
                routing_result.credential.id[:8],
                _sanitize_error(captured, secret=routing_result.secret),
            )
            try:
                async def _record(session):
                    await self._routing_engine.record_result(
                        session,
                        credential_id=routing_result.credential.id,
                        endpoint_id=routing_result.endpoint.id,
                        upstream_model_id=routing_result.upstream_model.id,
                        error=routing_result.adapter.classify_error(captured),
                        http_status=None,
                    )
                await run_in_session(_record)
            except Exception:
                logger.warning("Failed to record mid-stream failure", exc_info=True)
            raise

    async def _stream_response(
        self,
        response: Any,
        *,
        client_has_tools: bool = False,
        on_complete: Callable[[int | None], Awaitable[None]] | None = None,
    ) -> StreamingResponse:
        """OpenAI-shaped SSE pass-through.

        The first upstream chunk is pulled before the client-facing
        StreamingResponse is built, so a pre-first-chunk upstream failure
        raises here and the candidate loop can fail over.  After the first
        chunk the stream is pass-through (real TTFB); when HoloNe stream
        inspection is enabled the stream is buffered first — redaction
        cannot happen after bytes were sent.  ``on_complete`` fires with
        the total token count (``None`` when unknown) after the upstream
        stream ends.
        """
        primed = await prime_stream(response)
        return await stream_openai_response(
            primed,
            holone_service=get_holone_service(),
            client_has_tools=client_has_tools,
            on_complete=on_complete,
        )

    async def _stream_response_buffered(
        self,
        response: Any,
        *,
        client_has_tools: bool,
        on_complete: Callable[[int | None], Awaitable[None]] | None,
    ) -> StreamingResponse:
        """Buffered variant for HoloNe-enabled runs: collect, inspect/redact, emit."""
        primed = await prime_stream(response)
        return await stream_openai_response_buffered(
            primed,
            holone_service=get_holone_service(),
            client_has_tools=client_has_tools,
            on_complete=on_complete,
        )

    async def _stream_anthropic_response(
        self,
        response: Any,
        *,
        client_has_tools: bool = False,
        on_complete: Callable[[int | None], Awaitable[None]] | None = None,
    ) -> StreamingResponse:
        """Anthropic-shaped SSE pass-through (same contract as OpenAI)."""
        primed = await prime_stream(response)
        return await stream_anthropic_response(
            primed,
            holone_service=get_holone_service(),
            client_has_tools=client_has_tools,
            on_complete=on_complete,
        )

    async def _stream_anthropic_response_buffered(
        self,
        response: Any,
        *,
        client_has_tools: bool,
        on_complete: Callable[[int | None], Awaitable[None]] | None,
    ) -> StreamingResponse:
        """Buffered Anthropic variant for HoloNe-enabled runs."""
        primed = await prime_stream(response)
        return await stream_anthropic_response_buffered(
            primed,
            holone_service=get_holone_service(),
            client_has_tools=client_has_tools,
            on_complete=on_complete,
        )
