from __future__ import annotations

import json
from typing import TYPE_CHECKING

from pydantic import BaseModel

if TYPE_CHECKING:
    from stitch_backend.domains.ai_proxy.litellm_gateway import JsonObject


def _usage_split(response: JsonObject) -> tuple[int, int] | None:
    """(input_tokens, output_tokens) from a response body; None when absent.

    Usage frames that only carry a total are returned as ``(0, total)``.
    """
    usage = response.get("usage")
    if not isinstance(usage, dict):
        return None
    input_tokens = max(
        _integer(usage.get("input_tokens")),
        _integer(usage.get("prompt_tokens")),
    )
    output_tokens = max(
        _integer(usage.get("output_tokens")),
        _integer(usage.get("completion_tokens")),
    )
    if input_tokens > 0 or output_tokens > 0:
        return (input_tokens, output_tokens)
    for key in ("total_tokens", "totalTokens"):
        total = _integer(usage.get(key))
        if total > 0:
            return (0, total)
    return None


def _usage_split_from_sse_line(line: str) -> tuple[int, int] | None:
    """(input_tokens, output_tokens) from a raw SSE ``data: {...}`` line."""
    if not line.startswith("data:"):
        return None
    payload = line[5:].strip()
    if not payload or payload == "[DONE]":
        return None
    try:
        data = json.loads(payload)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    return _usage_split(data)


def _anthropic_usage_from_sse_line(line: str) -> tuple[int, int] | None:
    """Extract (input_tokens, output_tokens) from an Anthropic SSE line."""
    if not line.startswith("data:"):
        return None
    payload = line[5:].strip()
    if not payload or payload == "[DONE]":
        return None
    try:
        data = json.loads(payload)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    usage = data.get("usage")
    if not isinstance(usage, dict):
        # message_start carries usage under ``message``
        message = data.get("message")
        usage = message.get("usage") if isinstance(message, dict) else None
    if not isinstance(usage, dict):
        return None
    return (_integer(usage.get("input_tokens")), _integer(usage.get("output_tokens")))


def _integer(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _json_object(response: JsonObject | BaseModel) -> JsonObject:
    if isinstance(response, BaseModel):
        return response.model_dump(mode="json")
    return response


def _shape_response_model(
    response: JsonObject,
    public_model: str | None,
    upstream_model: str | None,
) -> JsonObject:
    """Expose the public role name while preserving upstream attribution.

    Upstream passthrough bodies commonly echo the concrete upstream model id
    (for example ``qwen-max``) in the standard ``model`` field.  Gateway
    clients asked for a public role (``rb/lead``) and use the response field
    for their own accounting, so the client-facing shape must echo that role
    back.  The concrete id remains available in the additive ``x-stitch``
    extension; request traces/logs also keep their independent upstream-model
    columns for operator debugging.
    """
    if not public_model or not isinstance(response, dict):
        return response

    observed = response.get("model")
    observed_upstream = observed if isinstance(observed, str) and observed else None
    response["model"] = public_model

    preserved = (
        observed_upstream
        if observed_upstream and observed_upstream != public_model
        else upstream_model
    )
    if not preserved or preserved == public_model:
        return response

    extension = response.get("x-stitch")
    if not isinstance(extension, dict):
        extension = {}
    extension["upstream_model"] = preserved
    response["x-stitch"] = extension
    return response
