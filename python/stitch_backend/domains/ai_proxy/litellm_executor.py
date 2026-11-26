from __future__ import annotations

import asyncio
import logging
import random
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol, cast

from fastapi import HTTPException
from sqlalchemy import exc as sqlalchemy_exc

from stitch_backend.core.event_bus import event_bus
from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway import circuit_breaker, model_latency, model_throughput
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error
from stitch_backend.domains.ai_gateway.pricing_cache import estimate_usd, get_pricing_cache
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
from stitch_backend.domains.ai_proxy import key_inflight
from stitch_backend.domains.ai_proxy.compression.service import get_compression_service
from stitch_backend.domains.ai_proxy.cost_tracker import get_cost_tracker
from stitch_backend.domains.ai_proxy.holone_service import get_holone_service
from stitch_backend.domains.ai_proxy.key_metrics import get_metrics_tracker
from stitch_backend.domains.ai_proxy.litellm_errors import is_managed_routing_error
from stitch_backend.domains.ai_proxy.litellm_gateway import _earliest_recovery_seconds
from stitch_backend.domains.ai_proxy.litellm_invoke_pipeline import (
    _classify_invoke_failure,
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
    StreamStallError,
    _anthropic_frame_has_content,
    _openai_frame_has_content,
    notify_stream_complete,
    prime_stream,
    stream_anthropic_response,
    stream_anthropic_response_buffered,
    stream_openai_response,
    stream_openai_response_buffered,
)
from stitch_backend.domains.ai_proxy.request_logs import persist_request_log
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


@dataclass
class _RequestOutcome:
    """Facts about one client request, filled across failover attempts."""

    model: str
    owner_id: int | None
    started_at: float = field(default_factory=time.time)
    routing_result: Any | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    ok: bool = False
    failover_count: int = 0
    error_class: str | None = None
    persisted: bool = False
    requested_model: str | None = None
    served_public_model: str | None = None
    attempt_reasons: list[str] = field(default_factory=list)
    sticky_hit: bool = False


@dataclass
class _StreamTiming:
    first_chunk_at: float | None = None
    last_chunk_at: float | None = None


__all__ = [
    "CompletionRouter",
    "ConfigLoader",
    "LiteLLMExecutor",
    "_public_models_auto_created",
    "auto_create_public_models_from_config",
]


_HOLD_BUDGET_STREAM_S = 45.0
_HOLD_BUDGET_NONSTREAM_S = 15.0
_HOLD_BUDGET_MAX_S = 120.0
_MAX_UPSTREAM_INVOCATIONS = 8
_ROUND_BACKOFF_CAP_S = 10.0
_COST_RESERVE_USD = 0.5
_DEFAULT_COMPLETION_TOKENS = 512
_UNKNOWN_PRICING_LOGGED: set[tuple[str, str]] = set()


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


_MAX_ATTEMPT_REASONS = 16


def _append_attempt_reason(reasons: list[str], reason: str) -> None:
    """Append a bounded, machine-oriented failover reason (never free text)."""
    if len(reasons) >= _MAX_ATTEMPT_REASONS:
        return
    if not reasons or reasons[-1] != reason:
        reasons.append(reason[:160])


def _classified_attempt_reason(error: ClassifiedError | None) -> str:
    if error is None:
        return "unknown"
    return f"{error.category}:{error.error_code}" if error.error_code else error.category


def _is_client_error(exc: HTTPException) -> bool:
    status = exc.status_code
    return 400 <= status < 500 and status != 429


class _BudgetExhaustedError(UpstreamFailureError):
    def __init__(self, message: str, *, reason: str, retry_after: int | None) -> None:
        super().__init__(message, reason=reason, status_code=503)
        self.retry_after = retry_after


def _distinct_model_cap(endpoint: Any) -> int | None:
    """``health_policy.concurrency.distinctModelsPerKey`` for one endpoint.

    Defensive: anything but a positive int disables the distinct-model cap.
    """
    policy = getattr(endpoint, "health_policy", None)
    if not isinstance(policy, dict):
        return None
    concurrency = policy.get("concurrency")
    if not isinstance(concurrency, dict):
        return None
    value = concurrency.get("distinctModelsPerKey")
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def _hint_seconds(error: ClassifiedError | None) -> float:
    if error is None:
        return 0.0
    if error.retry_after_seconds is not None:
        return max(0.0, float(error.retry_after_seconds))
    if error.retry_at is not None:
        retry_at = error.retry_at
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=UTC)
        return max(0.0, (retry_at - datetime.now(UTC)).total_seconds())
    return 0.0


def _backoff_seconds(round_no: int, hint: float) -> float:
    exponent = min(round_no - 1, 4)
    draw = random.uniform(0.0, min(2.0 ** exponent, _ROUND_BACKOFF_CAP_S))
    return max(hint, draw)


def _estimate_prompt_tokens(messages: list[dict[str, Any]] | None) -> int:
    chars = sum(
        len(str(message.get("content")))
        for message in (messages or [])
        if isinstance(message, dict)
    )
    return max(int(chars / 4), 1)


def _completion_token_budget(payload: Any) -> int:
    value = getattr(payload, "max_tokens", None)
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return _DEFAULT_COMPLETION_TOKENS


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


def _record_ttft_observation(
    routing_result: Any | None,
    request_started_at: float | None,
) -> None:
    """Best-effort passive TTFT sample for routing order (never health state)."""
    if routing_result is None or request_started_at is None:
        return
    try:
        model_latency.model_latency_tracker.record(
            routing_result.credential.id,
            routing_result.upstream_model.id,
            (time.time() - request_started_at) * 1000.0,
        )
    except Exception:
        logger.debug("TTFT observation failed", exc_info=True)


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
                user=getattr(payload, "user", None),
                session_hint=getattr(payload, "session_hint", None),
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

    async def _is_endpoint_available(
        self,
        endpoint_id: str,
        probe_lease: circuit_breaker.ProbeLease | None = None,
    ) -> tuple[bool, circuit_breaker.ProbeLease | None]:
        """Re-check the circuit breaker for an endpoint before invoking.

        Routing checked availability once per candidate, but a failure on
        candidate N may have opened the circuit for an endpoint that candidate
        N+1 shares.  Half-open probes carry their lease token into this
        re-check so the same logical request is admitted exactly once while
        concurrent callers stay outside the circuit.

        Returns ``(available, lease)``.  Cache-hit resolutions bypass routing's
        breaker check entirely, so this re-check may itself win the
        open→half_open CAS; the won lease is returned (never discarded) so the
        caller can thread it into outcome recording — otherwise the half-open
        slot would wedge until the lost-probe timeout.
        """
        async def _check(session):
            return await circuit_breaker.check_endpoint_availability(
                session, endpoint_id, lease=probe_lease,
            )
        return await run_in_session(_check)

    async def _release_inconclusive_probe(self, routing_result: Any) -> None:
        """Free a half-open lease when local filtering prevents the probe call."""
        lease = getattr(routing_result, "probe_lease", None)
        if lease is None:
            return
        await self._release_probe_lease(routing_result.endpoint.id, lease)

    async def _release_probe_lease(
        self,
        endpoint_id: str,
        lease: circuit_breaker.ProbeLease | None,
    ) -> None:
        """Best-effort inconclusive resolve of one half-open lease.

        A no-op when the probe outcome was already recorded (the breaker is no
        longer half-open) or when a newer probe replaced this lease (the token
        no longer matches), so it is safe to call for every lease seen during
        the failover walk on every exit path.
        """
        if lease is None:
            return

        async def _release(session):
            await circuit_breaker.resolve_endpoint_probe_inconclusive(
                session, endpoint_id, lease=lease,
            )

        try:
            await run_in_session(_release)
        except Exception:
            logger.debug("Failed to release inconclusive half-open probe", exc_info=True)

    async def _skip_insufficient_balance(
        self, payload: Any, routing_result: Any, model: str,
    ) -> bool:
        credential = routing_result.credential
        remaining = getattr(credential, "remaining_usd", None)
        if remaining is None:
            return False
        base_url = getattr(routing_result.endpoint, "base_url", None)
        if not base_url:
            return False
        endpoint_id = getattr(routing_result.endpoint, "id", base_url)
        upstream_model = getattr(
            getattr(routing_result, "upstream_model", None), "upstream_model_id", None,
        )
        price_model = upstream_model or model
        price = await get_pricing_cache().price_for(base_url, price_model)
        if price is None:
            key = (endpoint_id, price_model)
            if key not in _UNKNOWN_PRICING_LOGGED:
                _UNKNOWN_PRICING_LOGGED.add(key)
                logger.info(
                    "pricing_unknown endpoint=%s model=%s - cost guard passes candidate through",
                    endpoint_id,
                    price_model,
                )
            return False
        estimate = estimate_usd(
            price,
            _estimate_prompt_tokens(payload.messages),
            _completion_token_budget(payload),
        )
        if estimate <= float(remaining) - _COST_RESERVE_USD:
            return False
        logger.debug(
            "Skipping candidate %s - estimated $%.6f exceeds remaining $%.2f minus $%.2f reserve",
            credential.id[:8],
            estimate,
            float(remaining),
            _COST_RESERVE_USD,
        )
        return True

    def _record_request_trace(
        self,
        *,
        model: str | None,
        routing_result: Any | None,
        latency_ms: float,
        failover_count: int,
        status: str,
        requested_model: str | None = None,
        served_public_model: str | None = None,
        failover_reasons: list[str] | tuple[str, ...] = (),
    ) -> None:
        if routing_result is None:
            return
        endpoint = routing_result.endpoint
        upstream = getattr(routing_result, "upstream_model", None)
        get_request_trace_store().record(
            RequestTrace(
                model=model or "",
                target=getattr(endpoint, "name", None) or endpoint.id,
                credential_id=routing_result.credential.id,
                latency_ms=latency_ms,
                failover_count=failover_count,
                status=status,
                timestamp=time.time(),
                requested_model=requested_model,
                served_public_model=served_public_model,
                upstream_model=getattr(upstream, "upstream_model_id", None),
                endpoint_id=getattr(endpoint, "id", None),
                lifecycle_status=getattr(routing_result, "lifecycle_status", None),
                sticky_hit=bool(getattr(routing_result, "sticky_hit", False)),
                failover_reasons=tuple(failover_reasons[:_MAX_ATTEMPT_REASONS]),
            )
        )

    def _record_model_throughput(
        self,
        *,
        model: str | None,
        routing_result: Any,
        latency_ms: float,
        prompt_tokens: int,
        completion_tokens: int,
        generation_ms: float,
    ) -> None:
        if not model or routing_result is None:
            return
        try:
            endpoint = getattr(routing_result, "endpoint", None)
            upstream = getattr(routing_result, "upstream_model", None)
            model_throughput.model_throughput_registry.record(
                model,
                endpoint_id=getattr(endpoint, "id", "") or "",
                upstream_model_id=getattr(upstream, "upstream_model_id", "") or "",
                latency_ms=latency_ms,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                generation_ms=generation_ms,
            )
        except Exception:
            logger.debug("Model throughput record failed", exc_info=True)

    def _record_outcome_throughput(
        self,
        model: str | None,
        outcome: _RequestOutcome,
    ) -> None:
        routing_result = outcome.routing_result
        if not outcome.ok or routing_result is None:
            return
        latency_ms = max((time.time() - outcome.started_at) * 1000.0, 0.0)
        self._record_model_throughput(
            model=model,
            routing_result=routing_result,
            latency_ms=latency_ms,
            prompt_tokens=outcome.input_tokens,
            completion_tokens=outcome.output_tokens,
            generation_ms=latency_ms,
        )

    def _timed_stream(self, stream: Any, timing: _StreamTiming) -> Any:
        async def _iterate() -> Any:
            async for line in stream:
                if line:
                    now = time.perf_counter()
                    if timing.first_chunk_at is None:
                        timing.first_chunk_at = now
                    timing.last_chunk_at = now
                yield line

        return _iterate()

    def _throughput_on_complete(
        self,
        on_complete: Callable[..., Awaitable[None]] | None,
        *,
        model: str | None,
        routing_result: Any,
        timing: _StreamTiming,
        request_started_at: float | None,
    ) -> Callable[..., Awaitable[None]]:
        async def _callback(
            usage: tuple[int, int] | None,
            ok: bool,
            failure_reason: str | None = None,
        ) -> None:
            await notify_stream_complete(on_complete, usage, ok, failure_reason)
            if not ok:
                return
            prompt_tokens, completion_tokens = usage if usage is not None else (0, 0)
            first = timing.first_chunk_at
            last = timing.last_chunk_at
            generation_ms = (
                (last - first) * 1000.0
                if first is not None and last is not None
                else 0.0
            )
            latency_ms = (
                max((time.time() - request_started_at) * 1000.0, 0.0)
                if request_started_at is not None
                else generation_ms
            )
            self._record_model_throughput(
                model=model,
                routing_result=routing_result,
                latency_ms=latency_ms,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                generation_ms=generation_ms,
            )

        return _callback

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
                    "upstream_model": getattr(
                        getattr(routing_result, "upstream_model", None), "upstream_model_id", None,
                    ),
                    "endpoint_id": getattr(routing_result.endpoint, "id", None),
                    "lifecycle_status": getattr(routing_result, "lifecycle_status", None),
                    "sticky_hit": bool(getattr(routing_result, "sticky_hit", False)),
                },
            )
        except Exception:
            logger.debug("Failed to emit failover event", exc_info=True)

    def _final_error(
        self,
        model: str,
        last_classified: ClassifiedError | None,
        last_routing_error: RoutingError | None,
        *,
        retry_after: int | None = None,
    ) -> RoutingError:
        if retry_after is not None:
            reason = last_classified.category if last_classified is not None else "no_route"
            message = (
                _canonical_failure_message(model, reason)
                if last_classified is not None
                else f"No route available for model: {model}"
            )
            return _BudgetExhaustedError(message, reason=reason, retry_after=retry_after)
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

    def _hold_budget(self, payload: GatewayRequest, max_wait_seconds: int | None) -> float:
        if max_wait_seconds is None:
            budget = _HOLD_BUDGET_STREAM_S if payload.stream else _HOLD_BUDGET_NONSTREAM_S
        else:
            budget = float(max_wait_seconds)
        return min(max(budget, 0.0), _HOLD_BUDGET_MAX_S)

    async def _final_retry_after(self, model: str, budget_expired: bool) -> int | None:
        if not budget_expired:
            return None
        recovery = await _earliest_recovery_seconds(model)
        if recovery is None:
            return None
        return min(max(int(recovery), 1), 3600)

    async def _run_failover(
        self,
        payload: GatewayRequest,
        config: BackgroundManagerConfig,
        invoke: Callable[[Any], Awaitable[JsonObject | Response]],
        pool: PoolScope | None = None,
        *,
        outcome: _RequestOutcome,
        max_wait_seconds: int | None = None,
    ) -> JsonObject | Response:
        """Walk candidate models and credentials in budgeted rounds.

        On total failure raises a canonical :class:`RoutingError` (never a raw
        upstream error), so the HTTP layer answers with one stable envelope.
        """
        requested_model = payload.model or ""
        start_time = time.time()
        budget = self._hold_budget(payload, max_wait_seconds)
        deadline = start_time + budget
        parking_enabled = budget > 0
        model_chain = self._model_chain(requested_model)
        failed_attempts = 0
        invocations = 0
        round_no = 0
        last_attempted: Any | None = None
        last_classified: ClassifiedError | None = None
        last_routing_error: RoutingError | None = None
        served_model = requested_model
        budget_expired = False

        probe_leases: dict[str, circuit_breaker.ProbeLease] = {}
        streaming_probe_lease_transferred: circuit_breaker.ProbeLease | None = None
        try:
            while True:
                round_no += 1
                round_invocations = 0
                round_hint = 0.0
                stop_round = False
                blocked_groups: set[str] = set()

                for model_index, model in enumerate(model_chain):
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

                    # Register every lease carried by this resolution up front:
                    # candidates skipped by later filtering or never reached at
                    # all must still have their half-open slot released.
                    for rr in routing_results:
                        rr_lease = getattr(rr, "probe_lease", None)
                        if rr_lease is not None:
                            probe_leases.setdefault(rr.endpoint.id, rr_lease)

                    for routing_result in routing_results:
                        group = getattr(routing_result.credential, "account_group", None)
                        if group is not None and group in blocked_groups:
                            continue
                        if invocations >= _MAX_UPSTREAM_INVOCATIONS:
                            stop_round = True
                            break
                        if parking_enabled and invocations > 0 and time.time() >= deadline:
                            budget_expired = True
                            stop_round = True
                            break
                        endpoint_id = routing_result.endpoint.id
                        carried_lease = (
                            getattr(routing_result, "probe_lease", None)
                            or probe_leases.get(endpoint_id)
                        )
                        availability = await self._is_endpoint_available(
                            endpoint_id,
                            carried_lease,
                        )
                        # Production returns ``(available, won_lease)``.  Several
                        # narrow executor unit-test doubles predate the probe-lease
                        # API and return only the boolean; treat that as no new
                        # lease rather than failing the failover walk.
                        if isinstance(availability, tuple):
                            available, won_lease = availability
                        else:
                            available, won_lease = availability, None
                        if won_lease is not None:
                            probe_leases[endpoint_id] = won_lease
                            if getattr(routing_result, "probe_lease", None) is None:
                                # Cache-hit resolutions bypass routing's breaker
                                # check, so this re-check may be the first (and only)
                                # probe admission.  Thread the won lease onto the
                                # candidate so outcome recording resolves the probe
                                # instead of wedging the half-open slot.
                                try:
                                    routing_result.probe_lease = won_lease
                                except (AttributeError, TypeError):
                                    pass
                        if not available:
                            _append_attempt_reason(outcome.attempt_reasons, "circuit_open")
                            logger.debug(
                                "Skipping candidate on endpoint %s — circuit open",
                                endpoint_id,
                            )
                            continue
                        if await self._skip_insufficient_balance(payload, routing_result, model):
                            _append_attempt_reason(outcome.attempt_reasons, "insufficient_balance")
                            # No early lease release here: the lease is shared by
                            # all same-endpoint candidates of this logical request,
                            # and a sibling may still serve as the probe.  The
                            # outer finally releases it on every exit path.
                            continue
                        credential_id = routing_result.credential.id
                        upstream_model_id = getattr(
                            getattr(routing_result, "upstream_model", None), "upstream_model_id", None,
                        )
                        distinct_cap = _distinct_model_cap(routing_result.endpoint)
                        if not key_inflight.try_acquire(
                            credential_id,
                            upstream_model_id,
                            distinct_model_cap=distinct_cap,
                        ):
                            _append_attempt_reason(outcome.attempt_reasons, "inflight_cap")
                            logger.debug(
                                "Skipping candidate on credential %s - at in-flight cap",
                                credential_id[:8],
                            )
                            # Lease release deferred to the outer finally — see above.
                            continue

                        slot_released = False

                        def _release_inflight_slot(
                            bound_credential_id: str = credential_id,
                            bound_upstream_model_id: str | None = upstream_model_id,
                        ) -> None:
                            nonlocal slot_released
                            if slot_released:
                                return
                            slot_released = True
                            key_inflight.release(bound_credential_id, bound_upstream_model_id)

                        # Streaming responses outlive ``invoke()`` by tens of
                        # seconds.  Hand the completion callback an idempotent
                        # releaser so the concurrency slot remains occupied for
                        # the actual generation, while failed/non-streaming
                        # invokes still release in the local finally below.
                        try:
                            routing_result.inflight_slot_release = _release_inflight_slot
                        except (AttributeError, TypeError):
                            pass
                        streaming_slot_transferred = False
                        try:
                            last_attempted = routing_result
                            invocations += 1
                            round_invocations += 1
                            result = await invoke(routing_result)
                        except HTTPException as e:
                            if _is_client_error(e):
                                raise
                            failed_attempts += 1
                            last_classified = _classify_invoke_failure(
                                routing_result.adapter,
                                e,
                                http_status=e.status_code,
                            )
                            _append_attempt_reason(
                                outcome.attempt_reasons,
                                _classified_attempt_reason(last_classified),
                            )
                            logger.warning(
                                "AI Gateway invoke failed for %s (credential=%s): %s — trying next candidate",
                                model, routing_result.credential.id[:8],
                                _sanitize_error(e, secret=routing_result.secret),
                            )
                        except Exception as e:
                            failed_attempts += 1
                            last_classified = _classify_invoke_failure(routing_result.adapter, e)
                            _append_attempt_reason(
                                outcome.attempt_reasons,
                                _classified_attempt_reason(last_classified),
                            )
                            logger.warning(
                                "AI Gateway invoke failed for %s (credential=%s): %s — trying next candidate",
                                model, routing_result.credential.id[:8],
                                _sanitize_error(e, secret=routing_result.secret),
                            )
                        else:
                            served_model = model
                            outcome.failover_count = failed_attempts
                            outcome.requested_model = requested_model
                            outcome.served_public_model = model
                            outcome.sticky_hit = bool(getattr(routing_result, "sticky_hit", False))
                            self._record_request_trace(
                                model=model,
                                routing_result=routing_result,
                                latency_ms=(time.time() - start_time) * 1000.0,
                                failover_count=failed_attempts,
                                status="success",
                                requested_model=requested_model,
                                served_public_model=model,
                                failover_reasons=outcome.attempt_reasons,
                            )
                            await self._emit_failover_event(
                                requested=requested_model,
                                served=served_model,
                                routing_result=routing_result,
                                failover_count=failed_attempts,
                                used_fallback=model_index > 0,
                            )
                            if payload.stream and getattr(
                                routing_result, "inflight_slot_stream_owned", False,
                            ):
                                streaming_slot_transferred = True
                                streaming_probe_lease_transferred = getattr(
                                    routing_result, "probe_lease", None,
                                )
                            return result
                        finally:
                            if not streaming_slot_transferred:
                                _release_inflight_slot()
                                # The lease belongs to this one logical probe and
                                # must resolve for every outcome.  Normal health
                                # recording has already closed/reopened the
                                # breaker (making this a no-op); if that recording
                                # itself failed, this still prevents the half-open
                                # slot from wedging until the lost-probe timeout.
                                await self._release_inconclusive_probe(routing_result)
                            # For a successfully primed stream both the in-flight
                            # slot and the half-open lease transfer to stream
                            # completion: prime time is only liveness, not the
                            # final endpoint/credential outcome.

                        round_hint = _hint_seconds(last_classified)
                        if last_classified.scope == "global":
                            stop_round = True
                            break
                        if last_classified.scope == "account" and group is not None:
                            blocked_groups.add(group)

                    if stop_round:
                        break

                if round_invocations == 0:
                    recovery = await _earliest_recovery_seconds(requested_model)
                    remaining = deadline - time.time()
                    if (
                        parking_enabled
                        and recovery is not None
                        and 0 < recovery <= remaining
                    ):
                        await asyncio.sleep(recovery)
                        if time.time() >= deadline:
                            budget_expired = True
                            break
                        continue
                    budget_expired = parking_enabled
                    break

                if stop_round and invocations >= _MAX_UPSTREAM_INVOCATIONS:
                    budget_expired = True
                    break
                if not parking_enabled:
                    break
                if stop_round and budget_expired:
                    break

                delay = _backoff_seconds(round_no, round_hint)
                if time.time() + delay > deadline:
                    budget_expired = True
                    break
                await asyncio.sleep(delay)

            outcome.failover_count = failed_attempts
            outcome.requested_model = requested_model
            if outcome.routing_result is None:
                outcome.routing_result = last_attempted
            outcome.sticky_hit = bool(getattr(last_attempted, "sticky_hit", False))
            self._record_request_trace(
                model=served_model,
                routing_result=last_attempted,
                latency_ms=(time.time() - start_time) * 1000.0,
                failover_count=failed_attempts,
                status="error",
                requested_model=requested_model,
                failover_reasons=outcome.attempt_reasons,
            )
            retry_after = await self._final_retry_after(requested_model, budget_expired)
            raise self._final_error(
                requested_model, last_classified, last_routing_error, retry_after=retry_after,
            )
        finally:
            # Lease-carrying candidates that were never attempted (early success,
            # client-error raise, budget break) still hold the half-open slot.
            # Release every lease seen on any routing result on every exit path;
            # the resolve is a no-op when outcome recording already settled it.
            for endpoint_id, lease in probe_leases.items():
                if lease is streaming_probe_lease_transferred:
                    # Ownership moved to the stream-completion callback together
                    # with the in-flight slot.  Releasing it here at prime time
                    # would make the real stream outcome too late to resolve the
                    # half-open probe.
                    continue
                await self._release_probe_lease(endpoint_id, lease)

    async def _persist_outcome(self, outcome: _RequestOutcome) -> None:
        if outcome.persisted:
            return
        outcome.persisted = True
        routing_result = outcome.routing_result
        await persist_request_log(
            run_in_session,
            model=outcome.model,
            upstream_model=getattr(
                getattr(routing_result, "upstream_model", None), "upstream_model_id", "",
            ),
            credential_id=getattr(getattr(routing_result, "credential", None), "id", ""),
            status="success" if outcome.ok else "error",
            input_tokens=outcome.input_tokens,
            output_tokens=outcome.output_tokens,
            latency_ms=(time.time() - outcome.started_at) * 1000.0,
            served_public_model=outcome.served_public_model,
            owner_id=outcome.owner_id,
            failover_count=outcome.failover_count,
            error_class=outcome.error_class,
        )

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
        outcome = _RequestOutcome(
            model=payload.model or "",
            owner_id=pool.owner_user_id if pool else None,
            requested_model=payload.model or "",
        )
        try:
            result = await self._run_failover(
                payload,
                config,
                lambda routing_result: self._invoke_via_gateway(
                    payload, routing_result, config, pool=pool, outcome=outcome,
                ),
                pool=pool,
                outcome=outcome,
                max_wait_seconds=payload.max_wait_seconds,
            )
        except Exception as exc:
            outcome.error_class = outcome.error_class or type(exc).__name__
            await self._persist_outcome(outcome)
            raise
        if not payload.stream:
            self._record_outcome_throughput(payload.model, outcome)
            await self._persist_outcome(outcome)
        return result

    async def _invoke_via_gateway(
        self, payload: GatewayRequest, routing_result: Any, config: BackgroundManagerConfig,
        pool: PoolScope | None = None, *, outcome: _RequestOutcome | None = None,
    ) -> JsonObject | Response:
        """Invoke upstream via AI Gateway routing result."""
        return await invoke_via_gateway(
            self, payload, routing_result, config, pool,
            get_metrics_tracker=get_metrics_tracker,
            get_cost_tracker=get_cost_tracker,
            run_in_session=run_in_session,
            outcome=outcome or _RequestOutcome(model=payload.model or "", owner_id=None),
        )

    async def messages(self, payload: GatewayRequest, pool: PoolScope | None = None) -> JsonObject | Response:
        config = await self._load_config()
        outcome = _RequestOutcome(
            model=payload.model or "",
            owner_id=pool.owner_user_id if pool else None,
            requested_model=payload.model or "",
        )
        try:
            result = await self._run_failover(
                payload,
                config,
                lambda routing_result: self._invoke_via_gateway_messages(
                    payload, routing_result, config, pool=pool, outcome=outcome,
                ),
                pool=pool,
                outcome=outcome,
                max_wait_seconds=payload.max_wait_seconds,
            )
        except Exception as exc:
            outcome.error_class = outcome.error_class or type(exc).__name__
            await self._persist_outcome(outcome)
            raise
        if not payload.stream:
            self._record_outcome_throughput(payload.model, outcome)
            await self._persist_outcome(outcome)
        return result

    async def _invoke_via_gateway_messages(
        self, payload: GatewayRequest, routing_result: Any, config: BackgroundManagerConfig,
        pool: PoolScope | None = None, *, outcome: _RequestOutcome | None = None,
    ) -> JsonObject | Response:
        """Invoke upstream via AI Gateway routing result (Anthropic Messages API)."""
        return await invoke_via_gateway_messages(
            self, payload, routing_result, config, pool,
            get_metrics_tracker=get_metrics_tracker,
            get_cost_tracker=get_cost_tracker,
            run_in_session=run_in_session,
            outcome=outcome or _RequestOutcome(model=payload.model or "", owner_id=None),
        )

    async def responses(self, payload: GatewayRequest, pool: PoolScope | None = None) -> JsonObject | Response:
        config = await self._load_config()
        outcome = _RequestOutcome(
            model=payload.model or "",
            owner_id=pool.owner_user_id if pool else None,
            requested_model=payload.model or "",
        )
        try:
            result = await self._run_failover(
                payload,
                config,
                lambda routing_result: self._invoke_via_gateway_responses(
                    payload, routing_result, config, pool=pool, outcome=outcome,
                ),
                pool=pool,
                outcome=outcome,
                max_wait_seconds=payload.max_wait_seconds,
            )
        except Exception as exc:
            outcome.error_class = outcome.error_class or type(exc).__name__
            await self._persist_outcome(outcome)
            raise
        if not payload.stream:
            self._record_outcome_throughput(payload.model, outcome)
            await self._persist_outcome(outcome)
        return result

    async def _invoke_via_gateway_responses(
        self, payload: GatewayRequest, routing_result: Any, config: BackgroundManagerConfig,
        pool: PoolScope | None = None, *, outcome: _RequestOutcome | None = None,
    ) -> JsonObject | Response:
        """Invoke upstream via AI Gateway routing result (Responses API)."""
        return await invoke_via_gateway_responses(
            self, payload, routing_result, config, pool,
            get_metrics_tracker=get_metrics_tracker,
            get_cost_tracker=get_cost_tracker,
            run_in_session=run_in_session,
            outcome=outcome or _RequestOutcome(model=payload.model or "", owner_id=None),
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

    async def _guard_stream(
        self,
        stream: Any,
        routing_result: Any,
        *,
        stall_timeout: float | None = None,
    ) -> Any:
        """Wrap an upstream SSE iterator: on mid-stream failure, mark the
        credential/endpoint, then abort the client stream.

        Pass-through streaming cannot retry after bytes were sent, so the
        only correct response to a mid-flight upstream error is to record
        it (cooldown/circuit breaker) and propagate.  A failure before the
        first line is left to the invoke pipeline, which can still fail
        over to the next candidate.

        When ``stall_timeout`` is given, every frame pull is budgeted:
        silence longer than the budget raises :class:`StreamStallError`.
        Before the first frame the error escapes unrecorded (the pipeline
        treats it like the TTFT watchdog — slowness, failover-safe); after
        the first frame the stall is recorded as a *model-level* failure —
        a reliability signal for this one upstream model, never endpoint
        or credential blame.
        """
        started = False
        iterator = stream.__aiter__()
        try:
            while True:
                try:
                    if stall_timeout is not None:
                        try:
                            line = await asyncio.wait_for(
                                iterator.__anext__(), stall_timeout,
                            )
                        except TimeoutError as exc:
                            raise StreamStallError(
                                f"upstream stream silent for {stall_timeout:.2f}s"
                            ) from exc
                    else:
                        line = await iterator.__anext__()
                except StopAsyncIteration:
                    break
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
            if isinstance(captured, StreamStallError):
                from stitch_backend.domains.ai_gateway.adapters.base import (
                    ClassifiedError,
                )

                classified: Any = ClassifiedError(
                    category="server_error",
                    is_endpoint_wide=False,
                    is_model_specific=True,
                    scope="key",
                    error_code="stream_stall",
                )
            else:
                classified = routing_result.adapter.classify_error(captured)
            try:
                async def _record(session):
                    await self._routing_engine.record_result(
                        session,
                        credential_id=routing_result.credential.id,
                        endpoint_id=routing_result.endpoint.id,
                        upstream_model_id=routing_result.upstream_model.id,
                        error=classified,
                        http_status=None,
                        probe_lease=getattr(routing_result, "probe_lease", None),
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
        on_complete: Callable[[tuple[int, int] | None, bool], Awaitable[None]] | None = None,
        model: str | None = None,
        routing_result: Any | None = None,
        request_started_at: float | None = None,
        ttft_timeout: float | None = None,
    ) -> StreamingResponse:
        """OpenAI-shaped SSE pass-through.

        The first upstream chunk is pulled before the client-facing
        StreamingResponse is built, so a pre-first-chunk upstream failure
        raises here and the candidate loop can fail over.  After the first
        chunk the stream is pass-through (real TTFB); when HoloNe stream
        inspection is enabled the stream is buffered first — redaction
        cannot happen after bytes were sent.  ``on_complete`` fires with
        ``(input_tokens, output_tokens)`` (``None`` when unknown) plus an
        ``ok`` flag after the upstream stream ends, including on client
        disconnect.

        ``ttft_timeout`` budgets the wait for the first *meaningful*
        (content-bearing) frame; on expiry :class:`TtftWatchdogError`
        raises here — still before the client stream opened, so failover
        is safe.
        """
        timing = _StreamTiming()
        if model is not None and routing_result is not None:
            response = self._timed_stream(response, timing)
            on_complete = self._throughput_on_complete(
                on_complete,
                model=model,
                routing_result=routing_result,
                timing=timing,
                request_started_at=request_started_at,
            )
        primed = await prime_stream(
            response,
            first_frame_timeout=ttft_timeout,
            content_check=_openai_frame_has_content if ttft_timeout is not None else None,
        )
        _record_ttft_observation(routing_result, request_started_at)
        return await stream_openai_response(
            primed,
            holone_service=get_holone_service(),
            client_has_tools=client_has_tools,
            on_complete=on_complete,
            public_model=model,
            upstream_model=getattr(
                getattr(routing_result, "upstream_model", None), "upstream_model_id", None,
            ),
        )

    async def _stream_response_buffered(
        self,
        response: Any,
        *,
        client_has_tools: bool,
        on_complete: Callable[[tuple[int, int] | None, bool], Awaitable[None]] | None,
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
        on_complete: Callable[[tuple[int, int] | None, bool], Awaitable[None]] | None = None,
        model: str | None = None,
        routing_result: Any | None = None,
        request_started_at: float | None = None,
        ttft_timeout: float | None = None,
    ) -> StreamingResponse:
        """Anthropic-shaped SSE pass-through (same contract as OpenAI)."""
        timing = _StreamTiming()
        if model is not None and routing_result is not None:
            response = self._timed_stream(response, timing)
            on_complete = self._throughput_on_complete(
                on_complete,
                model=model,
                routing_result=routing_result,
                timing=timing,
                request_started_at=request_started_at,
            )
        primed = await prime_stream(
            response,
            first_frame_timeout=ttft_timeout,
            content_check=_anthropic_frame_has_content if ttft_timeout is not None else None,
        )
        _record_ttft_observation(routing_result, request_started_at)
        return await stream_anthropic_response(
            primed,
            holone_service=get_holone_service(),
            client_has_tools=client_has_tools,
            on_complete=on_complete,
            public_model=model,
            upstream_model=getattr(
                getattr(routing_result, "upstream_model", None), "upstream_model_id", None,
            ),
        )

    async def _stream_anthropic_response_buffered(
        self,
        response: Any,
        *,
        client_has_tools: bool,
        on_complete: Callable[[tuple[int, int] | None, bool], Awaitable[None]] | None,
    ) -> StreamingResponse:
        """Buffered Anthropic variant for HoloNe-enabled runs."""
        primed = await prime_stream(response)
        return await stream_anthropic_response_buffered(
            primed,
            holone_service=get_holone_service(),
            client_has_tools=client_has_tools,
            on_complete=on_complete,
        )
