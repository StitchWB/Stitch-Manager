"""AWS Event Stream binary frame parser for Kiro CodeWhisperer API.

Parses the AWS Event Stream binary protocol (not text/SSE) used by
CodeWhisperer's generateAssistantResponse and AmazonQ's SendMessageStreaming.
Port of the reference TypeScript parseEventStream logic from kiroApi.ts.

Frame format (big-endian):
  - 4 bytes: total length (uint32)
  - 4 bytes: headers length (uint32)
  - 4 bytes: prelude CRC
  - headers (variable)
  - payload (variable)
  - 4 bytes: message CRC
"""

from __future__ import annotations

import json
import struct
from collections.abc import AsyncGenerator
from typing import TypedDict

from stitch_backend.domains.kiro_gateway.translator.kiro_types import JsonValue

# ── Event types ────────────────────────────────────────────────────────────────


class AssistantResponseEvent(TypedDict, total=False):
    content: str


class ToolUseEvent(TypedDict, total=False):
    toolUseId: str
    name: str
    input: str | dict[str, JsonValue]
    stop: bool


class ReasoningContentEvent(TypedDict, total=False):
    text: str
    signature: str
    redactedContent: str


class ContextUsageBreakdown(TypedDict, total=False):
    conversation: float
    mcpTools: float
    steeringFiles: float


class ContextUsageEvent(TypedDict, total=False):
    contextUsagePercentage: float
    breakdown: ContextUsageBreakdown


class CodeEvent(TypedDict, total=False):
    content: str


class MessageMetadataEvent(TypedDict, total=False):
    tokenUsage: dict[str, int]
    inputTokens: int
    outputTokens: int


class MeteringEvent(TypedDict, total=False):
    usage: float


class InvalidStateEvent(TypedDict, total=False):
    reason: str
    message: str


class ParsedEvent(TypedDict, total=False):
    event_type: str
    assistantResponse: AssistantResponseEvent
    toolUse: ToolUseEvent
    reasoning: ReasoningContentEvent
    contextUsage: ContextUsageEvent
    code: CodeEvent
    metadata: MessageMetadataEvent
    metering: MeteringEvent
    error: InvalidStateEvent


# ── Binary frame parser ────────────────────────────────────────────────────────


def _extract_event_type(headers: bytes) -> str:
    """Extract the ':event-type' string value from AWS Event Stream binary headers."""
    offset = 0
    while offset < len(headers):
        if offset >= len(headers):
            break
        name_len = headers[offset]
        offset += 1
        if offset + name_len > len(headers):
            break
        name = headers[offset : offset + name_len].decode()
        offset += name_len
        if offset >= len(headers):
            break
        value_type = headers[offset]
        offset += 1

        if value_type == 7:  # String
            if offset + 2 > len(headers):
                break
            value_len = (headers[offset] << 8) | headers[offset + 1]
            offset += 2
            if offset + value_len > len(headers):
                break
            value = headers[offset : offset + value_len].decode()
            offset += value_len
            if name == ":event-type":
                return value
            continue

        # Skip non-string value types
        skip_sizes: dict[int, int] = {0: 0, 1: 0, 2: 1, 3: 2, 4: 4, 5: 8, 8: 8, 9: 16}
        if value_type == 6:  # ByteArray
            if offset + 2 > len(headers):
                break
            b_len = (headers[offset] << 8) | headers[offset + 1]
            offset += 2 + b_len
        elif value_type in skip_sizes:
            offset += skip_sizes[value_type]
        else:
            break
    return ""


def _decode_event(event_type: str, payload: bytes) -> ParsedEvent:
    """Decode a single AWS Event Stream frame payload into a typed ParsedEvent."""
    result: ParsedEvent = {"event_type": event_type}

    try:
        data: dict[str, JsonValue] = json.loads(payload.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return result

    # assistantResponseEvent / codeEvent — streaming text content
    has_assistant = data.get("assistantResponseEvent")
    has_code = data.get("codeEvent")
    if event_type in ("assistantResponseEvent", "codeEvent") or has_assistant or has_code:
        inner = data.get("assistantResponseEvent") or data.get("codeEvent") or data
        content = inner.get("content")
        if isinstance(content, str) and content:
            if event_type == "assistantResponseEvent" or (has_assistant and not event_type == "codeEvent"):
                result["assistantResponse"] = AssistantResponseEvent(content=content)
            else:
                result["code"] = CodeEvent(content=content)

    # toolUseEvent — tool call with fragment accumulation
    if event_type == "toolUseEvent" or data.get("toolUseEvent"):
        tue = data.get("toolUseEvent") or data
        result["toolUse"] = ToolUseEvent(
            toolUseId=str(tue.get("toolUseId", "")),
            name=str(tue.get("name", "")),
            input=tue.get("input", ""),
            stop=bool(tue.get("stop", False)),
        )

    # reasoningContentEvent — thinking mode
    if event_type == "reasoningContentEvent" or data.get("reasoningContentEvent"):
        rc = data.get("reasoningContentEvent") or data
        reasoning: ReasoningContentEvent = {}
        if isinstance(rc.get("text"), str):
            reasoning["text"] = rc["text"]
        if isinstance(rc.get("signature"), str):
            reasoning["signature"] = rc["signature"]
        if isinstance(rc.get("redactedContent"), str):
            reasoning["redactedContent"] = rc["redactedContent"]
        if reasoning:
            result["reasoning"] = reasoning

    # contextUsageEvent — context window usage percentage
    if event_type == "contextUsageEvent" or data.get("contextUsageEvent"):
        cue = data.get("contextUsageEvent") or data
        if "contextUsagePercentage" in cue:
            cu_event: ContextUsageEvent = {
                "contextUsagePercentage": float(cue["contextUsagePercentage"])
            }
            bd = cue.get("breakdown")
            if isinstance(bd, dict):
                cu_event["breakdown"] = ContextUsageBreakdown(
                    conversation=float(bd.get("conversation", 0)),
                    mcpTools=float(bd.get("mcpTools", 0)),
                    steeringFiles=float(bd.get("steeringFiles", 0)),
                )
            result["contextUsage"] = cu_event

    # messageMetadataEvent / metadataEvent — token usage
    if event_type in ("messageMetadataEvent", "metadataEvent") or data.get(
        "messageMetadataEvent"
    ) or data.get("metadataEvent"):
        md = data.get("messageMetadataEvent") or data.get("metadataEvent") or data
        result["metadata"] = MessageMetadataEvent(
            tokenUsage=md.get("tokenUsage") if isinstance(md.get("tokenUsage"), dict) else {},
            inputTokens=int(md.get("inputTokens", 0)),
            outputTokens=int(md.get("outputTokens", 0)),
        )

    # meteringEvent — credit usage
    if event_type == "meteringEvent" or data.get("meteringEvent"):
        me = data.get("meteringEvent") or data
        if isinstance(me.get("usage"), (int, float)):
            result["metering"] = MeteringEvent(usage=float(me["usage"]))

    # invalidStateEvent — server-side error
    if event_type == "invalidStateEvent" or data.get("invalidStateEvent"):
        inv = data.get("invalidStateEvent") or data
        result["error"] = InvalidStateEvent(
            reason=str(inv.get("reason", "UNKNOWN")),
            message=str(inv.get("message", "Invalid state detected")),
        )

    # Generic error: _type or error field present
    if data.get("_type") or data.get("error"):
        err_msg = str(data.get("message") or data.get("error", {}).get("message", "Unknown stream error"))
        result["error"] = InvalidStateEvent(reason="STREAM_ERROR", message=err_msg)

    return result


# ── Public API ─────────────────────────────────────────────────────────────────


async def parse_event_stream(
    body: bytes,
) -> AsyncGenerator[ParsedEvent, None]:
    """Parse an AWS Event Stream binary body into a sequence of typed events.

    Yields one ParsedEvent per frame. Handles frames split across buffer
    boundaries (incremental decode).

    Args:
        body: Raw bytes of the complete AWS Event Stream response body.

    Yields:
        ParsedEvent dicts with event_type and typed sub-dicts.
    """
    # ponytail: buffer-based incremental parse (not streaming from network —
    # httpx already buffers the full response body for the generator)
    buf = bytearray(body)
    offset = 0

    while offset + 16 <= len(buf):
        # Read total length (big-endian uint32)
        total_len = struct.unpack_from(">I", buf, offset)[0]

        if total_len < 16 or offset + total_len > len(buf):
            break  # Incomplete frame, wait for more data

        # Read headers length
        headers_len = struct.unpack_from(">I", buf, offset + 4)[0]

        # Extract headers (offset 12 = after prelude: 4+4+4 bytes)
        headers_start = offset + 12
        headers_end = headers_start + headers_len
        headers = buf[headers_start:headers_end]
        event_type = _extract_event_type(bytes(headers))

        # Extract payload
        payload_start = headers_end
        payload_end = offset + total_len - 4  # minus message CRC
        if payload_start < payload_end:
            payload = bytes(buf[payload_start:payload_end])
            yield _decode_event(event_type, payload)

        offset += total_len


async def parse_event_stream_from_bytes(
    data: bytes,
) -> list[ParsedEvent]:
    """Convenience: parse all events from a byte buffer synchronously."""
    return [e async for e in parse_event_stream(data)]