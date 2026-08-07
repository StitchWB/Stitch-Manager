"""Claude message-content extraction and tool conversion.

Pure helpers used by `claude_in.claude_to_kiro`: pull text/images/documents/
tool-results out of Claude messages and convert Claude tool definitions into
Kiro tool wrappers.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from stitch_backend.domains.kiro_gateway.translator.kiro_types import (
    KIRO_MAX_TOOL_DESC_LEN,
    JsonValue,
    KiroToolResult,
    KiroToolUse,
    KiroToolWrapper,
    ToolNameRegistry,
    merge_cache_points,
    normalize_image_format,
    parse_claude_document_source,
    to_kiro_cache_point,
)

if TYPE_CHECKING:
    from stitch_backend.domains.kiro_gateway.translator.claude_types import (
        ClaudeMessage,
        ClaudeTool,
    )


def extract_claude_content(
    msg: ClaudeMessage,
) -> tuple[str, list[dict[str, JsonValue]], list[dict[str, JsonValue]], list[KiroToolResult], dict[str, str] | None]:
    images: list[dict[str, JsonValue]] = []
    documents: list[dict[str, JsonValue]] = []
    tool_results: list[KiroToolResult] = []
    content = ""
    cp = to_kiro_cache_point(msg.get("cache_control"))
    rc = msg.get("content", "")
    if isinstance(rc, str):
        content = rc
    elif isinstance(rc, list):
        for blk in rc:
            cp = merge_cache_points(cp, to_kiro_cache_point(blk.get("cache_control")))
            bt = blk.get("type", "")
            if bt == "text" and blk.get("text"):
                content += blk["text"]
            elif bt == "image" and blk.get("source", {}).get("type") == "base64":
                src = blk["source"]
                p = src["media_type"].split("/")
                if p[0] != "image" or not p[1]:
                    raise ValueError(f"Unsupported image media_type: {src['media_type']}")
                images.append({"format": normalize_image_format(p[1]), "source": {"bytes": src["data"]}})
            elif bt == "document" and blk.get("source"):
                if not blk.get("name"):
                    raise ValueError("document requires name")
                documents.append(parse_claude_document_source(blk["source"], blk["name"]))
            elif bt == "tool_result" and blk.get("tool_use_id"):
                trc = _extract_tool_result_text(blk.get("content"), images)
                tool_results.append(KiroToolResult(toolUseId=blk["tool_use_id"], content=[{"text": trc}], status="success"))
    return content, images, documents, tool_results, cp


def _extract_tool_result_text(
    tc: object, images: list[dict[str, JsonValue]]
) -> str:
    """Extract text from tool_result content, moving images to images list."""
    if isinstance(tc, str):
        return tc or "(empty)"
    if isinstance(tc, list):
        tps: list[str] = []
        eic = 0
        for b in tc:
            if b.get("type") == "text":
                tps.append(b.get("text", ""))
            elif b.get("type") == "image" and b.get("source", {}).get("type") == "base64":
                s = b["source"]
                mp = (s.get("media_type", "")).split("/")
                if mp[0] == "image" and mp[1]:
                    try:
                        images.append({"format": normalize_image_format(mp[1]), "source": {"bytes": s["data"]}})
                        eic += 1
                    except ValueError:
                        pass
        rc = "".join(tps)
        if not rc:
            return f"(tool returned {eic} image{'s' if eic > 1 else ''}, attached to this message)" if eic > 0 else "(no text output)"
        if eic > 0:
            rc += f"\n\n[Tool also returned {eic} image{'s' if eic > 1 else ''}, attached to this message]"
        return rc
    if tc is None:
        return "(no output)"
    return str(tc) or "(empty)"


def extract_claude_assistant_content(
    msg: ClaudeMessage,
    tnr: ToolNameRegistry,
) -> tuple[str, list[KiroToolUse], str, str | None, str | None]:
    """Returns (content, tool_uses, thinking, signature, redacted_content)."""
    tus: list[KiroToolUse] = []
    content = ""
    thinking = ""
    sig: str | None = None
    red: str | None = None
    rc = msg.get("content", "")
    if isinstance(rc, str):
        content = rc
    elif isinstance(rc, list):
        for blk in rc:
            bt = blk.get("type", "")
            if bt == "text" and blk.get("text"):
                content += blk["text"]
            elif bt == "thinking" and blk.get("thinking"):
                thinking += blk["thinking"]
                sig = blk.get("signature") or sig
            elif bt == "redacted_thinking" and blk.get("data"):
                red = (red or "") + blk["data"]
            elif bt == "tool_use" and blk.get("id") and blk.get("name"):
                inp = blk.get("input")
                if not isinstance(inp, dict) or isinstance(inp, list):
                    raise ValueError(f"tool_use requires object input: {blk['name']}")
                tus.append(KiroToolUse(toolUseId=blk["id"], name=tnr.to_kiro_name(blk["name"]), input=inp))
    if not content.strip() and tus:
        content = " "
    return content, tus, thinking, sig, red


def convert_claude_tools(
    tools: list[ClaudeTool] | None,
    tnr: ToolNameRegistry,
) -> list[KiroToolWrapper]:
    if not tools:
        return []
    result: list[KiroToolWrapper] = []
    for t in tools:
        desc = t.get("description") or f"Tool: {t['name']}"
        if len(desc) > KIRO_MAX_TOOL_DESC_LEN:
            desc = desc[:KIRO_MAX_TOOL_DESC_LEN] + "..."
        w: KiroToolWrapper = KiroToolWrapper(
            toolSpecification={
                "name": tnr.to_kiro_name(t["name"]),
                "description": desc,
                "inputSchema": {"json": t["input_schema"]},
            }
        )
        cp = to_kiro_cache_point(t.get("cache_control"))
        result.append(w)
        if cp is not None:
            result.append(KiroToolWrapper(cachePoint=cp))
    return result
