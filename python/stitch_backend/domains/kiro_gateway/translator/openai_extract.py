"""OpenAI message-content extraction and tool conversion.

Pure helpers used by `openai_in.openai_to_kiro`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from stitch_backend.domains.kiro_gateway.translator.kiro_types import (
    KIRO_MAX_TOOL_DESC_LEN,
    JsonValue,
    KiroToolWrapper,
    ToolNameRegistry,
    merge_cache_points,
    normalize_document_format,
    parse_claude_document_source,
    parse_image_url,
    to_kiro_cache_point,
)

if TYPE_CHECKING:
    from stitch_backend.domains.kiro_gateway.translator.openai_types import (
        OpenAIMessage,
        OpenAITool,
    )


def _parse_openai_file_data(file_data: str, name: str) -> dict[str, JsonValue]:
    """Parse file_data (data URL or raw base64) into a Kiro document."""
    if file_data.startswith("data:"):
        data_url_match = file_data.split(",", 1)
        if len(data_url_match) == 2:
            header = data_url_match[0].removeprefix("data:")
            return {
                "format": normalize_document_format(header, name),
                "name": name,
                "source": {"bytes": data_url_match[1]},
            }
    return {
        "format": normalize_document_format(None, name),
        "name": name,
        "source": {"bytes": file_data},
    }


def extract_openai_content(
    msg: OpenAIMessage,
) -> tuple[str, list[dict[str, JsonValue]], list[dict[str, JsonValue]], dict[str, str] | None]:
    """Extract text, images, documents, and cache point from an OpenAI message."""
    images: list[dict[str, JsonValue]] = []
    documents: list[dict[str, JsonValue]] = []
    content = ""
    cp = to_kiro_cache_point(msg.get("cache_control"))

    mc = msg.get("content")
    if isinstance(mc, str):
        content = mc
    elif isinstance(mc, list):
        for part in mc:
            cp = merge_cache_points(cp, to_kiro_cache_point(part.get("cache_control")))
            ptype = part.get("type", "")
            if ptype == "text" and part.get("text"):
                content += part["text"]
            elif ptype == "image_url" and isinstance(part.get("image_url"), dict):
                url = str(part["image_url"].get("url", ""))
                img = parse_image_url(url)
                if img is not None:
                    images.append(img)
            elif ptype in ("file", "document"):
                if isinstance(part.get("file"), dict) and part["file"].get("file_data"):
                    fname = part["file"].get("filename") or part.get("name")
                    if not fname:
                        raise ValueError(f"{ptype} requires filename or name")
                    documents.append(
                        _parse_openai_file_data(str(part["file"]["file_data"]), str(fname))
                    )
                elif part.get("source"):
                    if not part.get("name"):
                        raise ValueError(f"{ptype} requires name")
                    documents.append(
                        parse_claude_document_source(
                            part["source"], str(part["name"])
                        )
                    )
                else:
                    raise ValueError(f"{ptype} requires file_data or source")

    return content, images, documents, cp


def convert_openai_tools(
    tools: list[OpenAITool] | None,
    tool_name_registry: ToolNameRegistry,
) -> list[KiroToolWrapper]:
    """Convert OpenAI tool definitions to Kiro tool wrappers."""
    if not tools:
        return []

    result: list[KiroToolWrapper] = []
    for tool in tools:
        func = tool.get("function") or {}
        desc = str(func.get("description") or f"Tool: {func.get('name', '')}")
        if len(desc) > KIRO_MAX_TOOL_DESC_LEN:
            desc = desc[:KIRO_MAX_TOOL_DESC_LEN] + "..."

        w: KiroToolWrapper = KiroToolWrapper(
            toolSpecification={
                "name": tool_name_registry.to_kiro_name(str(func.get("name", ""))),
                "description": desc,
                "inputSchema": {"json": func.get("parameters", {})},
            }
        )
        cp = to_kiro_cache_point(tool.get("cache_control"))
        result.append(w)
        if cp is not None:
            result.append(KiroToolWrapper(cachePoint=cp))
    return result
