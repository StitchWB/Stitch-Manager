from __future__ import annotations

import time
import uuid
from typing import TYPE_CHECKING, Any, TypedDict

if TYPE_CHECKING:
    from collections.abc import Callable

JsonScalar = str | int | float | bool | None
JsonValue = Any
JsonObject = dict[str, Any]


class OpenAIUsage(TypedDict, total=False):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    prompt_tokens_details: dict[str, int]
    completion_tokens_details: dict[str, int]


def _restore_tool_uses_identity(
    tool_uses: list[JsonObject],
) -> list[JsonObject]:
    return tool_uses


def kiro_to_openai_response(
    content: str,
    tool_uses: list[JsonObject],
    usage: JsonObject,
    model: str,
    *,
    restore_tool_uses: Callable[[list[JsonObject]], list[JsonObject]] = _restore_tool_uses_identity,
    reasoning_content: JsonObject | None = None,
) -> JsonObject:
    restored = restore_tool_uses(tool_uses)

    input_tokens: int = usage.get("inputTokens", 0)
    output_tokens: int = usage.get("outputTokens", 0)
    cache_read_tokens: int = usage.get("cacheReadTokens", 0)
    reasoning_tokens: int = usage.get("reasoningTokens", 0)

    openai_usage: JsonObject = {
        "prompt_tokens": input_tokens,
        "completion_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
    }
    if cache_read_tokens:
        openai_usage["prompt_tokens_details"] = {"cached_tokens": cache_read_tokens}
    if reasoning_tokens:
        openai_usage["completion_tokens_details"] = {"reasoning_tokens": reasoning_tokens}

    has_tool_calls = len(restored) > 0
    has_content = bool(content and content.strip())

    message: JsonObject = {
        "role": "assistant",
    }
    if has_tool_calls or not has_content:
        message["content"] = None
    else:
        message["content"] = content

    if reasoning_content and reasoning_content.get("text"):
        message["reasoning_content"] = reasoning_content["text"]

    if has_tool_calls:
        message["tool_calls"] = [
            {
                "id": tu["toolUseId"],
                "type": "function",
                "function": {
                    "name": tu["name"],
                    "arguments": _json_dumps(tu["input"]),
                },
            }
            for tu in restored
        ]

    return {
        "id": f"chatcmpl-{uuid.uuid4()}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": "tool_calls" if has_tool_calls else "stop",
            }
        ],
        "usage": openai_usage,
    }


def create_openai_stream_chunk(
    stream_id: str,
    model: str,
    delta: JsonObject,
    finish_reason: str | None = None,
    usage: OpenAIUsage | None = None,
) -> JsonObject:
    chunk: JsonObject = {
        "id": stream_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": delta,
                "finish_reason": finish_reason,
            }
        ],
    }
    if usage is not None:
        chunk["usage"] = dict(usage)
    return chunk


def _json_dumps(obj: object) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False)
