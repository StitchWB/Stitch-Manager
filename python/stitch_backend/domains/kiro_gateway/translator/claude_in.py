"""Claude /v1/messages → Kiro CodeWhisperer payload conversion.

Orchestration only: content extraction lives in `claude_extract.py`, shared
Kiro types/helpers in `kiro_types.py`, inbound models in `claude_types.py`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from stitch_backend.domains.kiro_gateway.translator.claude_extract import (
    convert_claude_tools,
    extract_claude_assistant_content,
    extract_claude_content,
)
from stitch_backend.domains.kiro_gateway.translator.kiro_types import (
    _EXECUTION_DIRECTIVE,
    JsonObject,
    JsonValue,
    KiroAssistantResponseMessage,
    KiroHistoryMessage,
    KiroToolResult,
    KiroUserInputMessage,
    ToolNameRegistry,
    merge_cache_points,
    to_kiro_cache_point,
)

# ── Cross-agent imports ──────────────────────────────────────────────────────
# ponytail: build_thinking_fields (sibling), map_model_id + build_kiro_payload (Wave 3).
from stitch_backend.domains.kiro_gateway.translator.thinking import (
    build_thinking_fields,  # noqa: E402
)
from stitch_backend.domains.kiro_gateway.upstream.models import map_model_id  # noqa: E402
from stitch_backend.domains.kiro_gateway.upstream.payload import build_kiro_payload  # noqa: E402

if TYPE_CHECKING:
    from stitch_backend.domains.kiro_gateway.translator.claude_types import ClaudeRequest


def _mk_uim(
    pc: str, pi: list[dict[str, JsonValue]], pd: list[dict[str, JsonValue]],
    ptr: list[KiroToolResult], pcp: dict[str, str] | None,
    mid: str, origin: str,
) -> KiroUserInputMessage:
    uim: KiroUserInputMessage = KiroUserInputMessage(
        content=pc or ("Tool results provided." if ptr else "Continue"),
        modelId=mid,
        origin=origin,
    )
    if pi:
        uim["images"] = pi
    if pd:
        uim["documents"] = pd
    if pcp is not None:
        uim["cachePoint"] = pcp
    if ptr:
        uim["userInputMessageContext"] = {"toolResults": ptr}
    return uim


def claude_to_kiro(
    request: ClaudeRequest,
    profile_arn: str | None = None,
    tool_name_registry: ToolNameRegistry | None = None,
) -> JsonObject:
    """Convert a Claude /v1/messages request to a Kiro payload."""
    if tool_name_registry is None:
        from stitch_backend.domains.kiro_gateway.translator.tool_norm import (
            default_tool_name_registry,  # noqa: E402
        )
        tool_name_registry = default_tool_name_registry()

    model_id = map_model_id(request["model"])
    origin = "AI_EDITOR"

    # System prompt
    sp = ""
    scp: dict[str, str] | None = None
    rs = request.get("system")
    if isinstance(rs, str):
        sp = rs
    elif isinstance(rs, list):
        parts: list[str] = []
        for b in rs:
            scp = merge_cache_points(scp, to_kiro_cache_point(b.get("cache_control")))
            parts.append(str(b.get("text", "")))
        sp = "\n".join(parts)
    sp = f"[Context: Current time is {datetime.now(UTC).isoformat()}]\n\n{sp}\n\n{_EXECUTION_DIRECTIVE}"

    # Build history
    history: list[KiroHistoryMessage] = []
    ctr: list[KiroToolResult] = []
    cc = ""
    ccp: dict[str, str] | None = None
    images: list[dict[str, JsonValue]] = []
    documents: list[dict[str, JsonValue]] = []
    pc = ""
    pi: list[dict[str, JsonValue]] = []
    pd: list[dict[str, JsonValue]] = []
    ptr: list[KiroToolResult] = []
    pcp: dict[str, str] | None = None

    msgs = request.get("messages", [])
    for i, msg in enumerate(msgs):
        if msg.get("role") == "user":
            uc, ui, ud, utr, ucp = extract_claude_content(msg)
            if i == len(msgs) - 1:
                cc = (pc + "\n" + uc) if pc else uc
                images.extend(pi)
                images.extend(ui)
                documents.extend(pd)
                documents.extend(ud)
                ctr = [*ptr, *utr]
                ccp = merge_cache_points(pcp, ucp)
                pc = ""
                pi = []
                pd = []
                ptr = []
                pcp = None
            else:
                nxt = msgs[i + 1]
                if nxt.get("role") == "assistant":
                    fuc = (pc + "\n" + uc) if pc else uc
                    if fuc.strip() or pi or ui or pd or ud or ptr or utr:
                        history.append(KiroHistoryMessage(userInputMessage=_mk_uim(
                            fuc, [*pi, *ui], [*pd, *ud], [*ptr, *utr],
                            merge_cache_points(pcp, ucp), model_id, origin,
                        )))
                    pc = ""
                    pi = []
                    pd = []
                    ptr = []
                    pcp = None
                else:
                    pc = (pc + "\n" + uc) if pc else uc
                    pi.extend(ui)
                    pd.extend(ud)
                    ptr.extend(utr)
                    pcp = merge_cache_points(pcp, ucp)
        elif msg.get("role") == "assistant":
            ac, tus, _th, _sig, _red = extract_claude_assistant_content(msg, tool_name_registry)
            if pc.strip() or pi or pd or ptr:
                history.append(KiroHistoryMessage(userInputMessage=_mk_uim(
                    pc, pi, pd, ptr, pcp, model_id, origin,
                )))
            pc = ""
            pi = []
            pd = []
            ptr = []
            pcp = None
            arm: KiroAssistantResponseMessage = KiroAssistantResponseMessage(content=ac)
            if tus:
                arm["toolUses"] = tus
            history.append(KiroHistoryMessage(assistantResponseMessage=arm))

    if pc.strip() or pi or pd or ptr:
        cc = pc + ("\n" + cc if cc else "")
        images = [*pi, *images]
        documents = [*pd, *documents]
        ctr = [*ptr, *ctr]
        ccp = merge_cache_points(pcp, ccp)

    if history and "assistantResponseMessage" in history[0]:
        history.insert(0, KiroHistoryMessage(
            userInputMessage=KiroUserInputMessage(
                content="Begin conversation", modelId=model_id, origin=origin,
            )
        ))

    if sp:
        sui: KiroUserInputMessage = KiroUserInputMessage(
            content=sp, userInputMessageContext={}, origin=origin,
        )
        if scp is not None:
            sui["cachePoint"] = scp
        history = [
            KiroHistoryMessage(userInputMessage=sui),
            KiroHistoryMessage(assistantResponseMessage=KiroAssistantResponseMessage(
                content="I will follow these instructions."
            )),
            *history,
        ]

    fc = cc or ("Tool results provided." if ctr else "Continue")
    kt = convert_claude_tools(request.get("tools"), tool_name_registry)
    tp = request.get("thinking")
    amrf = build_thinking_fields(tp if isinstance(tp, dict) else None, None)

    return build_kiro_payload(
        fc, model_id, origin, history, kt, ctr, images, profile_arn,
        {
            "maxTokens": request.get("max_tokens"),
            "temperature": request.get("temperature"),
            "topP": request.get("top_p"),
        },
        {
            "cachePoint": ccp,
            "documents": documents,
            "conversationId": request.get("conversation_id"),
            "context": request.get("kiro_context"),
        },
        amrf,
    )
