from __future__ import annotations

import json
from typing import TYPE_CHECKING

from pydantic import BaseModel

if TYPE_CHECKING:
    from stitch_backend.domains.ai_proxy.litellm_gateway import JsonObject


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


def _tokens_from_sse_line(line: str) -> int | None:
    """Extract total token usage from a raw SSE ``data: {...}`` line."""
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
    return _usage_tokens(data)


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
