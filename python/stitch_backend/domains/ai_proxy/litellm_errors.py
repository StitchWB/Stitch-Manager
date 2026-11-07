from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi.responses import JSONResponse

from stitch_backend.domains.ai_gateway.routing_engine import (
    ContextLengthExceededError,
    QuotaExceededError,
    RoutingError,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

# routing_engine has no typed class for exhaustion; its message is the only signal.
_EXHAUSTED_MARKER = "No eligible credentials found"


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


def _is_exhausted(exc: RoutingError) -> bool:
    return _EXHAUSTED_MARKER in str(exc)


def is_managed_routing_error(exc: RoutingError) -> bool:
    """True when the model is gateway-managed and the failure is a routing refusal.

    A bare ``RoutingError`` for an unknown/disabled public model means the model
    is not managed by the gateway, so the caller keeps its fallback path.
    """
    if isinstance(exc, (QuotaExceededError, ContextLengthExceededError)):
        return True
    return _is_exhausted(exc)


def routing_error_status(exc: RoutingError) -> int:
    """HTTP status for a routing failure: typed status wins, then exhaustion, else 503."""
    status = getattr(exc, "status_code", None)
    if isinstance(status, int) and not isinstance(status, bool):
        return status
    if isinstance(exc, QuotaExceededError) or _is_exhausted(exc):
        return 429
    return 503


def _reason_code(exc: RoutingError) -> str:
    reason = getattr(exc, "reason", None)
    if isinstance(reason, str) and reason:
        return reason
    if isinstance(exc, ContextLengthExceededError):
        return "context_length_exceeded"
    if isinstance(exc, QuotaExceededError):
        return "quota_exceeded"
    if _is_exhausted(exc):
        return "all_credentials_exhausted"
    return "no_route"


def routing_error_payload(
    exc: RoutingError,
    *,
    retry_after: int | None = None,
    unavailable_models: Sequence[str] | None = None,
) -> dict[str, object]:
    error: dict[str, object] = {
        "message": str(exc),
        "reason": _reason_code(exc),
    }
    if isinstance(exc, ContextLengthExceededError):
        error["model"] = exc.model
        error["requested_tokens"] = exc.requested_tokens
        error["max_tokens"] = exc.max_tokens
    if isinstance(exc, QuotaExceededError) and exc.groups:
        error["groups"] = list(exc.groups)
    if retry_after is not None:
        error["retry_after"] = retry_after
    if unavailable_models:
        error["unavailable_models"] = list(unavailable_models)
    return {"error": error}


def routing_error_response(
    exc: RoutingError,
    *,
    retry_after: int | None = None,
    unavailable_models: Sequence[str] | None = None,
) -> JSONResponse:
    headers = {"Retry-After": str(retry_after)} if retry_after is not None else None
    return JSONResponse(
        status_code=routing_error_status(exc),
        content=routing_error_payload(
            exc, retry_after=retry_after, unavailable_models=unavailable_models,
        ),
        headers=headers,
    )
