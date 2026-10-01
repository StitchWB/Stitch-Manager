from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Protocol, cast

from fastapi import HTTPException
from sqlalchemy import exc as sqlalchemy_exc

from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway import circuit_breaker
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error
from stitch_backend.domains.ai_gateway.routing_engine import GatewayRequest as AIGatewayRequest
from stitch_backend.domains.ai_gateway.routing_engine import (
    PoolScope,
    QuotaExceededError,
    RoutingEngine,
    RoutingError,
)
from stitch_backend.domains.ai_gateway.usage_tracker import record_usage as _record_group_usage
from stitch_backend.domains.ai_proxy.compression.service import get_compression_service
from stitch_backend.domains.ai_proxy.cost_tracker import get_cost_tracker
from stitch_backend.domains.ai_proxy.holone_service import get_holone_service
from stitch_backend.domains.ai_proxy.key_metrics import get_metrics_tracker
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
    stream_anthropic_response,
    stream_anthropic_response_buffered,
    stream_openai_response,
    stream_openai_response_buffered,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from fastapi.responses import StreamingResponse
    from pydantic import BaseModel
    from starlette.responses import Response

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
        except QuotaExceededError as e:
            logger.info("Group quota exceeded for %s: %s", payload.model, e)
            raise HTTPException(
                status_code=429,
                detail={
                    "error": {
                        "type": "quota_exceeded",
                        "message": str(e),
                        "groups": e.groups,
                    }
                },
            ) from e
        except RoutingError as e:
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
                    result = await self._invoke_via_gateway(payload, routing_result, config, pool=pool)
                except Exception as e:
                    logger.warning(
                        "AI Gateway invoke failed for %s (credential=%s): %s — trying next candidate",
                        payload.model, routing_result.credential.id[:8], e,
                    )
                    continue
                return result

        raise HTTPException(
            status_code=503,
            detail={"error": {"message": f"No route available for model: {payload.model}"}},
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
                    result = await self._invoke_via_gateway_messages(payload, routing_result, config, pool=pool)
                except Exception as e:
                    logger.warning(
                        "AI Gateway invoke failed for %s (credential=%s): %s — trying next candidate",
                        payload.model, routing_result.credential.id[:8], e,
                    )
                    continue
                return result

        raise HTTPException(
            status_code=503,
            detail={"error": {"message": f"No route available for model: {payload.model}"}},
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
                    result = await self._invoke_via_gateway_responses(payload, routing_result, config, pool=pool)
                except Exception as e:
                    logger.warning(
                        "AI Gateway invoke failed for %s (credential=%s): %s — trying next candidate",
                        payload.model, routing_result.credential.id[:8], e,
                    )
                    continue
                return result

        raise HTTPException(
            status_code=503,
            detail={"error": {"message": f"No route available for model: {payload.model}"}},
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
        it (cooldown/circuit breaker) and propagate.
        """
        try:
            async for line in stream:
                yield line
        except Exception as exc:
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

        Upstream adapters yield raw SSE lines (``data: {...}``).  Default
        path streams them to the client as they arrive (real TTFB) while
        extracting token usage from chunk payloads.  When HoloNe stream
        inspection is enabled the stream is buffered first — redaction
        cannot happen after bytes were sent.  ``on_complete`` fires with
        the total token count (``None`` when unknown) after the upstream
        stream ends.
        """
        return await stream_openai_response(
            response,
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
        return await stream_openai_response_buffered(
            response,
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
        return await stream_anthropic_response(
            response,
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
        return await stream_anthropic_response_buffered(
            response,
            holone_service=get_holone_service(),
            client_has_tools=client_has_tools,
            on_complete=on_complete,
        )
