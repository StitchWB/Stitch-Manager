from __future__ import annotations

import uuid
from typing import Any, Protocol, TypedDict, cast

# ── Type aliases ─────────────────────────────────────────────────────────────

JsonScalar = str | int | float | bool | None
JsonValue = Any
JsonObject = dict[str, Any]

# ── Kiro domain types ────────────────────────────────────────────────────────


class KiroToolUse(TypedDict):
    toolUseId: str
    name: str
    input: dict[str, JsonValue]


class KiroUsage(TypedDict, total=False):
    inputTokens: int
    outputTokens: int
    credits: int
    cacheReadTokens: int
    cacheWriteTokens: int
    reasoningTokens: int


# ── Claude domain types ──────────────────────────────────────────────────────


class ClaudeContentBlock(TypedDict, total=False):
    type: str
    text: str
    thinking: str
    signature: str
    data: str
    id: str
    name: str
    input: dict[str, JsonValue]


class ClaudeResponse(TypedDict):
    id: str
    type: str
    role: str
    content: list[ClaudeContentBlock]
    model: str
    stop_reason: str | None
    stop_sequence: str | None
    usage: JsonObject


class ClaudeStreamDelta(TypedDict, total=False):
    type: str
    text: str
    thinking: str
    signature: str
    data: str
    stop_reason: str
    stop_sequence: str


class ClaudeStreamEvent(TypedDict, total=False):
    type: str
    message: JsonObject
    index: int
    content_block: ClaudeContentBlock
    delta: ClaudeStreamDelta
    usage: JsonObject
    error: JsonObject


# ── ToolNameRegistry Protocol ────────────────────────────────────────────────


class ToolNameRegistry(Protocol):
    def to_kiro_name(self, name: str) -> str: ...

    def restore_tool_uses(self, tool_uses: list[KiroToolUse]) -> list[KiroToolUse]: ...


# ── kiro_to_claude_response ──────────────────────────────────────────────────


def kiro_to_claude_response(
    content: str,
    tool_uses: list[KiroToolUse],
    usage: KiroUsage,
    model: str,
    tool_name_registry: ToolNameRegistry | None = None,
    reasoning_content: dict[str, str] | None = None,
) -> ClaudeResponse:
    """Convert a Kiro assistant response to a Claude /v1/messages response."""
    if tool_name_registry is None:
        from stitch_backend.domains.kiro_gateway.translator.tool_norm import (  # noqa: E402
            default_tool_name_registry,
        )

        tool_name_registry = cast("ToolNameRegistry", default_tool_name_registry())

    content_blocks: list[ClaudeContentBlock] = []
    restored_tool_uses = tool_name_registry.restore_tool_uses(tool_uses)

    # Thinking / redacted_thinking blocks
    if reasoning_content and reasoning_content.get("text"):
        if reasoning_content.get("signature"):
            content_blocks.append(
                ClaudeContentBlock(
                    type="thinking",
                    thinking=reasoning_content["text"],
                    signature=reasoning_content["signature"],
                )
            )
        else:
            content_blocks.append(
                ClaudeContentBlock(
                    type="thinking",
                    thinking=reasoning_content["text"],
                )
            )
    if reasoning_content and reasoning_content.get("redactedContent"):
        content_blocks.append(
            ClaudeContentBlock(
                type="redacted_thinking",
                data=reasoning_content["redactedContent"],
            )
        )

    # Text block (only when there is actual content)
    if content and content.strip():
        content_blocks.append(ClaudeContentBlock(type="text", text=content))

    # Tool use blocks
    for tu in restored_tool_uses:
        content_blocks.append(
            ClaudeContentBlock(
                type="tool_use",
                id=tu["toolUseId"],
                name=tu["name"],
                input=tu["input"],
            )
        )

    # Usage
    claude_usage: dict[str, JsonValue] = {
        "input_tokens": usage["inputTokens"],
        "output_tokens": usage["outputTokens"],
    }
    if usage.get("cacheWriteTokens"):
        claude_usage["cache_creation_input_tokens"] = usage["cacheWriteTokens"]
    if usage.get("cacheReadTokens"):
        claude_usage["cache_read_input_tokens"] = usage["cacheReadTokens"]

    return ClaudeResponse(
        id=f"msg_{uuid.uuid4()}",
        type="message",
        role="assistant",
        content=content_blocks,
        model=model,
        stop_reason="tool_use" if restored_tool_uses else "end_turn",
        stop_sequence=None,
        usage=claude_usage,
    )


# ── create_claude_stream_event ───────────────────────────────────────────────


def create_claude_stream_event(
    event_type: str,
    **data: JsonValue,
) -> ClaudeStreamEvent:
    """Create a Claude streaming event.

    Args:
        event_type: One of 'message_start', 'content_block_start',
            'content_block_delta', 'content_block_stop', 'message_delta',
            'message_stop', 'ping', 'error'.
        **data: Event-specific fields (message, index, content_block, delta,
            usage, error).
    """
    event: ClaudeStreamEvent = ClaudeStreamEvent(type=event_type)
    event.update(cast("Any", data))
    return event
