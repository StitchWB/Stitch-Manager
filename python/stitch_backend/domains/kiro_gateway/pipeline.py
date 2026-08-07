"""Format conversion between client API shapes and Kiro payloads/responses.

Extracted from executor.py: inbound translation (OpenAI/Claude/Responses →
Kiro payload) and outbound response building (Kiro result → client format).
Pure functions; lazy imports avoid pulling translator modules at app import.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from fastapi import HTTPException

if TYPE_CHECKING:
    from stitch_backend.domains.ai_proxy.litellm_gateway import JsonObject
    from stitch_backend.domains.kiro_gateway.translator.claude_types import ClaudeRequest
    from stitch_backend.domains.kiro_gateway.translator.openai_types import (
        OpenAIChatRequest,
        OpenAIChatResponse,
        OpenAIResponsesRequest,
    )

_INVALID_RESP = {"error": {"message": "Invalid upstream response"}}


def translate_inbound(body: JsonObject, endpoint: str) -> JsonObject:
    """Convert an inbound client request body to a Kiro payload."""
    if endpoint == "chat":
        from stitch_backend.domains.kiro_gateway.translator.openai_in import (
            openai_to_kiro,
        )
        return openai_to_kiro(cast("OpenAIChatRequest", body))
    if endpoint == "messages":
        from stitch_backend.domains.kiro_gateway.translator.claude_in import (
            claude_to_kiro,
        )
        return claude_to_kiro(cast("ClaudeRequest", body))
    if endpoint == "responses":
        from stitch_backend.domains.kiro_gateway.translator.openai_in import (
            openai_to_kiro,
        )
        from stitch_backend.domains.kiro_gateway.translator.responses_conv import (
            responses_to_openai_chat,
        )
        chat = responses_to_openai_chat(cast("OpenAIResponsesRequest", body))
        return openai_to_kiro(chat)
    raise HTTPException(
        status_code=500,
        detail={"error": {"message": f"Unknown endpoint: {endpoint}"}},
    )


def build_client_response(result: object, endpoint: str, body: JsonObject) -> JsonObject:
    """Build the client-facing response for a completed upstream call."""
    from stitch_backend.domains.kiro_gateway.upstream.client import KiroStreamResult

    if not isinstance(result, KiroStreamResult):
        raise HTTPException(status_code=502, detail=_INVALID_RESP)

    model = str(body.get("model", "claude-sonnet-4.5"))
    tool_uses = [dict(tu) for tu in result.tool_uses]
    usage = dict(result.usage)

    if endpoint == "chat":
        from stitch_backend.domains.kiro_gateway.translator.openai_out import (
            kiro_to_openai_response,
        )
        return kiro_to_openai_response(
            result.content, tool_uses, usage, model,
            reasoning_content=(
                {"text": result.reasoning_text, "signature": result.reasoning_signature or ""}
                if result.reasoning_text else None
            ),
        )

    if endpoint == "messages":
        from stitch_backend.domains.kiro_gateway.translator.claude_out import (
            kiro_to_claude_response,
        )
        return dict(kiro_to_claude_response(
            result.content, tool_uses, usage, model,
            reasoning_content=(
                {"text": result.reasoning_text, "redactedContent": result.redacted_content}
                if result.reasoning_text else None
            ),
        ))

    if endpoint == "responses":
        from stitch_backend.domains.kiro_gateway.translator.openai_out import (
            kiro_to_openai_response,
        )
        from stitch_backend.domains.kiro_gateway.translator.responses_conv import (
            openai_chat_to_responses_response,
        )
        chat_resp = kiro_to_openai_response(result.content, tool_uses, usage, model)
        prev_id = body.get("previous_response_id")
        return dict(openai_chat_to_responses_response(
            cast("OpenAIChatResponse", chat_resp),
            previous_response_id=str(prev_id) if isinstance(prev_id, str) else None,
        ))

    raise HTTPException(
        status_code=500,
        detail={"error": {"message": f"Unknown endpoint: {endpoint}"}},
    )
