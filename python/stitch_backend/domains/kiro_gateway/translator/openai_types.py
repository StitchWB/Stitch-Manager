"""OpenAI API inbound/outbound TypedDicts (translator layer)."""

from __future__ import annotations

from typing import TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    from stitch_backend.domains.kiro_gateway.translator.kiro_types import JsonObject, JsonValue


class OpenAIMessage(TypedDict, total=False):
    role: str
    content: str | list[JsonObject] | None
    tool_calls: list[JsonObject]
    tool_call_id: str
    name: str
    cache_control: dict[str, str]


class OpenAITool(TypedDict, total=False):
    type: str
    function: dict[str, JsonValue]
    cache_control: dict[str, str]


class OpenAIChatRequest(TypedDict, total=False):
    model: str
    messages: list[OpenAIMessage]
    temperature: float
    top_p: float
    max_tokens: int
    stream: bool
    tools: list[OpenAITool]
    tool_choice: str | dict[str, JsonValue]
    reasoning_effort: str
    thinking: dict[str, JsonValue]
    conversation_id: str
    metadata: dict[str, JsonValue]
    kiro_context: dict[str, JsonValue]


class OpenAIChatResponse(TypedDict, total=False):
    id: str
    object: str
    created: int
    model: str
    choices: list[JsonObject]
    usage: JsonObject


class OpenAIResponsesRequest(TypedDict, total=False):
    model: str
    input: str | list[JsonObject]
    instructions: str
    temperature: float
    top_p: float
    max_output_tokens: int
    stream: bool
    tools: list[OpenAITool]
    tool_choice: str | dict[str, JsonValue]
    previous_response_id: str
    metadata: dict[str, JsonValue]
    kiro_context: dict[str, JsonValue]


class OpenAIResponsesResponse(TypedDict, total=False):
    id: str
    object: str
    created_at: int
    model: str
    output: list[JsonObject]
    usage: JsonObject
    previous_response_id: str
