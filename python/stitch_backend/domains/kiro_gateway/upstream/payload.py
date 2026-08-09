"""Kiro payload builder, system prompt injection, history trimming, and identity headers.

Reference: _references/.../kiroApi.ts (buildKiroPayload, injectSystemPrompts,
trimHistoryByBytes, estimateTokens, BUILD_KIRO_PAYLOAD_HEADERS).
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC
from enum import StrEnum
from typing import TYPE_CHECKING, Any

from stitch_backend.domains.kiro_gateway.translator.kiro_types import (
    JsonObject,
    JsonValue,
    KiroHistoryMessage,
    KiroToolResult,
    KiroToolWrapper,
    KiroUserInputMessage,
)

if TYPE_CHECKING:
    from stitch_backend.domains.kiro_gateway.upstream.sanitize import (
        sanitize_conversation,  # noqa: F401
    )

# ── Constants ────────────────────────────────────────────────────────────────

KIRO_VERSION = "0.12.155"
AWS_SDK_VERSION = "1.0.34"
AWS_STREAMING_API_VERSION = "1.0.34"

BUILD_KIRO_PAYLOAD_HEADERS: dict[str, str] = {
    "content-type": "application/json",
    "x-amz-user-agent": (
        f"aws-sdk-js/{AWS_SDK_VERSION} KiroIDE {KIRO_VERSION}"
    ),
    "user-agent": (
        f"aws-sdk-js/{AWS_SDK_VERSION} ua/2.1 os/win32#10.0.19043 "
        f"lang/js md/nodejs#22.22.0 api/codewhispererstreaming#"
        f"{AWS_STREAMING_API_VERSION} m/E KiroIDE-{KIRO_VERSION}"
    ),
    "amz-sdk-invocation-id": "",
    "amz-sdk-request": "attempt=1; max=3",
}

AGENTIC_SYSTEM_PROMPT = """# CRITICAL: CHUNKED WRITE PROTOCOL (MANDATORY)

You MUST follow these rules for ALL file operations. Violation causes server timeouts and task failure.

## ABSOLUTE LIMITS
- **MAXIMUM 350 LINES** per single write/edit operation - NO EXCEPTIONS
- **RECOMMENDED 300 LINES** or less for optimal performance
- **NEVER** write entire files in one operation if >300 lines

## MANDATORY CHUNKED WRITE STRATEGY

### For NEW FILES (>300 lines total):
1. FIRST: Write initial chunk (first 250-300 lines) using write_to_file/fsWrite
2. THEN: Append remaining content in 250-300 line chunks using file append operations
3. REPEAT: Continue appending until complete

### For EDITING EXISTING FILES:
1. Use surgical edits (apply_diff/targeted edits) - change ONLY what's needed
2. NEVER rewrite entire files - use incremental modifications
3. Split large refactors into multiple small, focused edits

REMEMBER: When in doubt, write LESS per operation. Multiple small operations > one large operation."""

THINKING_MODE_PROMPT = "<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>200000</max_thinking_length>"


class AgentMode(StrEnum):
    VIBE = "vibe"
    SPEC = "spec"


# ── Token estimation ─────────────────────────────────────────────────────────


def estimate_tokens(text: str) -> int:
    """Estimate token count from UTF-8 bytes: ceil(bytes / 3.5).

    Slightly overestimates vs cl100k_base (10-20%), safe for triggering trim thresholds.
    """
    if not text:
        return 0
    byte_count = len(text.encode("utf-8"))
    return max(1, int((byte_count + 3) // 3.5)) if byte_count > 0 else 0  # ponytail: ceil via integer math


def _estimate_payload_tokens(payload: JsonObject) -> int:
    return estimate_tokens(json.dumps(payload))


# ── System prompt injection ──────────────────────────────────────────────────


def inject_system_prompts(
    content: str,
    is_agentic: bool,
    thinking_enabled: bool,
) -> str:
    """Inject timestamp, thinking-mode, and agentic prompts into content.

    Ports injectSystemPrompts verbatim from reference kiroApi.ts:427.
    """
    result = content

    if thinking_enabled:
        result = THINKING_MODE_PROMPT + "\n\n" + result

    if is_agentic:
        result = result + "\n\n" + AGENTIC_SYSTEM_PROMPT

    from datetime import datetime

    timestamp = datetime.now(UTC).isoformat()
    timestamp_prompt = f"Current time: {timestamp}"
    result = timestamp_prompt + "\n\n" + result

    return result


# ── History trimming ─────────────────────────────────────────────────────────


def trim_history(
    history: list[KiroHistoryMessage],
    _payload_size_bytes: int,
    _max_bytes: int,
    tool_result_truncate_length: int = 4000,
) -> tuple[list[KiroHistoryMessage], int]:
    """Trim history by token estimate and truncate large tool results.

    Returns (trimmed_history, trimmed_count).
    Token-based trimming is skipped by default (enable_token_buffer_reserve=False).
    Byte-based tool result truncation is always active.
    """
    if not history:
        return history, 0

    trimmed = 0
    # ponytail: bytes-based trim only (v1); token-based trim deferred to Wave 4+
    # Truncate individual tool results that exceed the limit
    for msg in history:
        um = msg.get("userInputMessage")
        if um is None:
            continue
        ctx = um.get("userInputMessageContext")
        if ctx is None:
            continue
        tool_results = ctx.get("toolResults")
        if not tool_results:
            continue
        for tr in tool_results:
            for ci in tr.get("content", []):
                text = ci.get("text", "")
                if len(text) > tool_result_truncate_length:
                    ci["text"] = (
                        text[:tool_result_truncate_length]
                        + f"\n\n[Truncated by proxy: original {len(text)} chars]"
                    )
                    trimmed += 1

    return history, trimmed


# ── Payload builder ──────────────────────────────────────────────────────────


def build_kiro_payload(
    content: str,
    model_id: str,
    origin: str,
    history: list[KiroHistoryMessage] | None = None,
    kiro_tools: list[KiroToolWrapper] | None = None,
    current_tool_results: list[KiroToolResult] | None = None,
    images: list[dict[str, JsonValue]] | None = None,
    profile_arn: str | None = None,
    inference_config: dict[str, int | float | None] | None = None,
    extra_options: dict[str, JsonValue] | None = None,
    additional_model_request_fields: dict[str, JsonValue] | None = None,
) -> JsonObject:
    """Build a Kiro CodeWhisperer payload matching the reference buildKiroPayload.

    Called positionally by translators (claude_in.py, openai_in.py) with 11 args.
    extra_options keys: cachePoint, documents, conversationId, context.
    """
    history = history or []
    kiro_tools = kiro_tools or []
    current_tool_results = current_tool_results or []
    images = images or []
    extra_options = extra_options or {}
    inference_config = inference_config or {}
    additional_model_request_fields = additional_model_request_fields or {}

    # ── Build current message ──────────────────────────────────────────────
    final_content = content.strip() or ("Continue" if not current_tool_results else "")

    current_uim: KiroUserInputMessage = KiroUserInputMessage(
        content=final_content,
        modelId=model_id,
        origin=origin,
    )

    if images:
        current_uim["images"] = images

    documents = extra_options.get("documents")
    if isinstance(documents, list) and documents:
        current_uim["documents"] = documents

    cache_point = extra_options.get("cachePoint")
    if isinstance(cache_point, dict) and cache_point:
        current_uim["cachePoint"] = cache_point

    # tools + toolResults in userInputMessageContext
    if kiro_tools or current_tool_results:
        uimc: dict[str, JsonValue] = {}
        if kiro_tools:
            uimc["tools"] = kiro_tools
        if current_tool_results:
            uimc["toolResults"] = current_tool_results
        current_uim["userInputMessageContext"] = uimc

    # context (editorState, shellState, gitState, etc.)
    ctx = extra_options.get("context")
    if isinstance(ctx, dict) and ctx:
        existing = current_uim.get("userInputMessageContext") or {}
        for key in ("editorState", "shellState", "gitState", "envState", "additionalContext"):
            if key in ctx:
                existing[key] = ctx[key]
        if existing:
            current_uim["userInputMessageContext"] = existing

    current_message: KiroHistoryMessage = KiroHistoryMessage(
        userInputMessage=current_uim,
    )

    # ── Sanitize ───────────────────────────────────────────────────────────
    from stitch_backend.domains.kiro_gateway.upstream.sanitize import (
        sanitize_conversation,  # noqa: E402
    )

    all_messages = [*history, current_message]
    sanitized = sanitize_conversation(all_messages)

    sanitized_history = sanitized[:-1]
    final_current = sanitized[-1]

    if not final_current.get("userInputMessage"):
        final_current = KiroHistoryMessage(
            userInputMessage=KiroUserInputMessage(
                content=final_content or "Continue",
                modelId=model_id,
                origin=origin,
            ),
        )

    # Ensure tools are on the final message
    fcuim = final_current["userInputMessage"]
    if fcuim is None:
        fcuim = KiroUserInputMessage(content=final_content or "Continue", modelId=model_id, origin=origin)
        final_current["userInputMessage"] = fcuim

    uimc_final: dict[str, Any] = fcuim.get("userInputMessageContext") or {}
    if kiro_tools:
        uimc_final["tools"] = kiro_tools
    if uimc_final:
        fcuim["userInputMessageContext"] = uimc_final

    # ── conversationId ─────────────────────────────────────────────────────
    conversation_id = extra_options.get("conversationId")
    if not isinstance(conversation_id, str):
        conversation_id = str(uuid.uuid4())

    # ── Assemble payload ───────────────────────────────────────────────────
    payload: JsonObject = {
        "conversationState": {
            "agentContinuationId": str(uuid.uuid4()),
            "agentTaskType": "vibe",
            "chatTriggerType": "MANUAL",
            "conversationId": conversation_id,
            "currentMessage": {"userInputMessage": fcuim},
            "history": sanitized_history if sanitized_history else None,
        }
    }

    if profile_arn is not None:
        payload["profileArn"] = profile_arn

    ic = inference_config
    if ic and (ic.get("maxTokens") or ic.get("temperature") is not None or ic.get("topP") is not None):
        ic_payload: dict[str, JsonValue] = {}
        if ic.get("maxTokens"):
            ic_payload["maxTokens"] = ic["maxTokens"]
        if ic.get("temperature") is not None:
            ic_payload["temperature"] = ic["temperature"]
        if ic.get("topP") is not None:
            ic_payload["topP"] = ic["topP"]
        payload["inferenceConfig"] = ic_payload

    if additional_model_request_fields:
        payload["additionalModelRequestFields"] = additional_model_request_fields

    return payload
