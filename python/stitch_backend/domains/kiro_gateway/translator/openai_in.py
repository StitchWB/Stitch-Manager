"""OpenAI /v1/chat/completions → Kiro CodeWhisperer payload conversion.

Orchestration only: content extraction in `openai_extract.py`, inbound models
in `openai_types.py`, shared Kiro types/helpers in `kiro_types.py`. The
Responses API converters live in `responses_conv.py`.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from stitch_backend.domains.kiro_gateway.translator.kiro_types import (
    _EXECUTION_DIRECTIVE,
    JsonObject,
    JsonValue,
    KiroAssistantResponseMessage,
    KiroHistoryMessage,
    KiroToolResult,
    KiroToolUse,
    KiroUserInputMessage,
    ToolNameRegistry,
    merge_cache_points,
    parse_image_url,
    to_kiro_cache_point,
)
from stitch_backend.domains.kiro_gateway.translator.openai_extract import (
    convert_openai_tools,
    extract_openai_content,
)
from stitch_backend.domains.kiro_gateway.translator.openai_types import (
    OpenAIChatRequest,
    OpenAIMessage,
)

# ── Cross-agent imports ────────────────────────────────────────────────────

from stitch_backend.domains.kiro_gateway.translator.thinking import build_thinking_fields  # noqa: E402
from stitch_backend.domains.kiro_gateway.upstream.models import map_model_id  # noqa: E402
from stitch_backend.domains.kiro_gateway.upstream.payload import build_kiro_payload  # noqa: E402


def _mk_uim(
    content: str,
    model_id: str,
    origin: str,
    images: list[dict[str, JsonValue]] | None = None,
    documents: list[dict[str, JsonValue]] | None = None,
    tool_results: list[KiroToolResult] | None = None,
    cache_point: dict[str, str] | None = None,
) -> KiroUserInputMessage:
    uim: KiroUserInputMessage = KiroUserInputMessage(
        content=content,
        modelId=model_id,
        origin=origin,
    )
    if images:
        uim["images"] = images
    if documents:
        uim["documents"] = documents
    if cache_point is not None:
        uim["cachePoint"] = cache_point
    if tool_results:
        uim["userInputMessageContext"] = {"toolResults": tool_results}
    return uim


def openai_to_kiro(
    request: OpenAIChatRequest,
    profile_arn: str | None = None,
    tool_name_registry: ToolNameRegistry | None = None,
) -> JsonObject:
    """Convert an OpenAI /v1/chat/completions request to a Kiro payload."""
    if tool_name_registry is None:
        from stitch_backend.domains.kiro_gateway.translator.tool_norm import default_tool_name_registry  # noqa: E402
        tool_name_registry = default_tool_name_registry()

    model_id = map_model_id(request["model"])
    origin = "AI_EDITOR"

    # ── Extract system prompt ──────────────────────────────────────────────
    system_prompt = ""
    system_cp: dict[str, str] | None = None
    non_system: list[OpenAIMessage] = []

    for msg in request.get("messages", []):
        if msg.get("role") == "system":
            system_cp = merge_cache_points(system_cp, to_kiro_cache_point(msg.get("cache_control")))
            mc = msg.get("content")
            if isinstance(mc, str):
                system_prompt += ("\n" if system_prompt else "") + mc
            elif isinstance(mc, list):
                for part in mc:
                    system_cp = merge_cache_points(system_cp, to_kiro_cache_point(part.get("cache_control")))
                    if part.get("type") == "text" and part.get("text"):
                        system_prompt += ("\n" if system_prompt else "") + part["text"]
        else:
            non_system.append(msg)

    timestamp = datetime.now(timezone.utc).isoformat()
    system_prompt = f"[Context: Current time is {timestamp}]\n\n{system_prompt}\n\n{_EXECUTION_DIRECTIVE}"

    # ── Build history ──────────────────────────────────────────────────────
    history: list[KiroHistoryMessage] = []
    tool_results: list[KiroToolResult] = []
    current_content = ""
    current_cp: dict[str, str] | None = None
    images: list[dict[str, JsonValue]] = []
    documents: list[dict[str, JsonValue]] = []

    for i, msg in enumerate(non_system):
        is_last = i == len(non_system) - 1
        role = msg.get("role", "")

        if role == "user":
            uc, ui, ud, ucp = extract_openai_content(msg)
            merged = uc or "Continue"
            if is_last:
                current_content = merged
                current_cp = ucp
                images.extend(ui)
                documents.extend(ud)
            else:
                history.append(KiroHistoryMessage(
                    userInputMessage=_mk_uim(
                        merged, model_id, origin,
                        images=ui if ui else None,
                        documents=ud if ud else None,
                        cache_point=ucp,
                    )
                ))

        elif role == "assistant":
            ac = msg.get("content")
            assistant_content = str(ac) if isinstance(ac, str) else ""
            tcs = msg.get("tool_calls")
            tool_uses: list[KiroToolUse] = []

            if not assistant_content.strip() and isinstance(tcs, list) and len(tcs) > 0:
                assistant_content = " "
            elif not assistant_content.strip():
                assistant_content = "I understand."

            if isinstance(tcs, list):
                for tc in tcs:
                    if tc.get("type") == "function":
                        fn = tc.get("function", {})
                        args = fn.get("arguments", "{}")
                        try:
                            inp = json.loads(str(args)) if isinstance(args, str) else args
                        except (json.JSONDecodeError, TypeError):
                            inp = {}
                        tool_uses.append(KiroToolUse(
                            toolUseId=str(tc.get("id", "")),
                            name=tool_name_registry.to_kiro_name(str(fn.get("name", ""))),
                            input=inp,
                        ))

            arm: KiroAssistantResponseMessage = KiroAssistantResponseMessage(
                content=assistant_content,
            )
            if tool_uses:
                arm["toolUses"] = tool_uses
            history.append(KiroHistoryMessage(assistantResponseMessage=arm))

        elif role == "tool":
            tid = msg.get("tool_call_id")
            if tid:
                raw_text = ""
                extracted = 0
                mc = msg.get("content")
                if isinstance(mc, list):
                    text_parts: list[str] = []
                    for part in mc:
                        if part.get("type") == "text" and isinstance(part.get("text"), str):
                            text_parts.append(part["text"])
                        elif part.get("type") == "image_url" and isinstance(part.get("image_url"), dict):
                            url = str(part["image_url"].get("url", ""))
                            img = parse_image_url(url)
                            if img is not None:
                                images.append(img)
                                extracted += 1
                    raw_text = "".join(text_parts)
                    if not raw_text and extracted == 0:
                        raw_text = json.dumps(mc)
                    if extracted > 0:
                        suffix = f"[Tool returned {extracted} image{'s' if extracted > 1 else ''}, attached to this message]"
                        raw_text = (raw_text + "\n\n" + suffix) if raw_text else suffix
                else:
                    raw_text = str(mc) if isinstance(mc, str) else json.dumps(mc)

                tool_results.append(KiroToolResult(
                    toolUseId=str(tid),
                    content=[{"text": raw_text or "(no output)"}],
                    status="success",
                ))

            next_msg = non_system[i + 1] if i + 1 < len(non_system) else None
            should_flush = next_msg is None or next_msg.get("role") != "tool"

            if should_flush and tool_results and not is_last:
                history.append(KiroHistoryMessage(
                    userInputMessage=_mk_uim(
                        "Tool results provided.", model_id, origin,
                        tool_results=list(tool_results),
                    )
                ))
                tool_results.clear()

    # ── Post-history fixups ─────────────────────────────────────────────────
    if history and "assistantResponseMessage" in history[-1] and not current_content:
        current_content = "Continue."
    if not current_content and tool_results:
        current_content = "Tool results provided."

    # ── Inject system prompt as Human/AI pair ───────────────────────────────
    if system_prompt:
        sui: KiroUserInputMessage = KiroUserInputMessage(
            content=system_prompt,
            userInputMessageContext={},
            origin=origin,
        )
        if system_cp is not None:
            sui["cachePoint"] = system_cp
        history = [
            KiroHistoryMessage(userInputMessage=sui),
            KiroHistoryMessage(assistantResponseMessage=KiroAssistantResponseMessage(
                content="I will follow these instructions."
            )),
            *history,
        ]

    final_content = current_content or "Continue."

    # ── Convert tools ───────────────────────────────────────────────────────
    kiro_tools = convert_openai_tools(request.get("tools"), tool_name_registry)

    # ── Thinking fields ─────────────────────────────────────────────────────
    tp = request.get("thinking")
    amrf = build_thinking_fields(
        tp if isinstance(tp, dict) else None,
        request.get("reasoning_effort"),
    )

    return build_kiro_payload(
        final_content,
        model_id,
        origin,
        history,
        kiro_tools,
        tool_results,
        images,
        profile_arn,
        {
            "maxTokens": request.get("max_tokens"),
            "temperature": request.get("temperature"),
            "topP": request.get("top_p"),
        },
        {
            "cachePoint": current_cp,
            "documents": documents,
            "conversationId": request.get("conversation_id"),
            "context": request.get("kiro_context"),
        },
        amrf,
    )
