"""Claude /v1/messages inbound TypedDicts (translator layer)."""

from __future__ import annotations

from typing import TypedDict

from stitch_backend.domains.kiro_gateway.translator.kiro_types import JsonValue


class ClaudeContentBlock(TypedDict, total=False):
    type: str
    text: str
    thinking: str
    signature: str
    data: str
    source: dict[str, str]
    id: str
    name: str
    input: dict[str, JsonValue]
    tool_use_id: str
    content: str | list[ClaudeContentBlock]
    cache_control: dict[str, str]


class ClaudeMessage(TypedDict, total=False):
    role: str
    content: str | list[ClaudeContentBlock]
    cache_control: dict[str, str]


class ClaudeTool(TypedDict, total=False):
    name: str
    description: str
    input_schema: JsonValue
    cache_control: dict[str, str]


class ClaudeRequest(TypedDict, total=False):
    model: str
    messages: list[ClaudeMessage]
    max_tokens: int
    temperature: float
    top_p: float
    stream: bool
    system: str | list[dict[str, JsonValue]]
    tools: list[ClaudeTool]
    thinking: dict[str, JsonValue]
    conversation_id: str
    kiro_context: dict[str, JsonValue]
