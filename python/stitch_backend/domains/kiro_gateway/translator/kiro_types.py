"""Shared Kiro payload types and pure helpers for the translator package.

Single home for everything both the Claude and OpenAI inbound translators
need: JSON aliases, Kiro CodeWhisperer TypedDicts, cache-point / image /
document helpers, and the execution-directive system-prompt suffix.
"""

from __future__ import annotations

import base64
from typing import Protocol, TypedDict

# ── JSON aliases ─────────────────────────────────────────────────────────────

JsonScalar = str | int | float | bool | None
JsonValue = JsonScalar | dict[str, JsonScalar] | list[JsonScalar | dict[str, JsonScalar]]
JsonObject = dict[str, JsonValue]

# ── Kiro domain types ────────────────────────────────────────────────────────


class KiroToolResult(TypedDict):
    content: list[dict[str, str]]
    status: str
    toolUseId: str


class KiroToolUse(TypedDict):
    toolUseId: str
    name: str
    input: dict[str, JsonValue]


class KiroToolWrapper(TypedDict, total=False):
    toolSpecification: dict[str, JsonValue]
    cachePoint: dict[str, str]


class KiroUserInputMessage(TypedDict, total=False):
    content: str
    modelId: str
    origin: str
    images: list[dict[str, JsonValue]]
    documents: list[dict[str, JsonValue]]
    cachePoint: dict[str, str]
    userInputMessageContext: dict[str, list[KiroToolResult]]


class KiroAssistantResponseMessage(TypedDict, total=False):
    content: str
    toolUses: list[KiroToolUse]


class KiroHistoryMessage(TypedDict, total=False):
    userInputMessage: KiroUserInputMessage
    assistantResponseMessage: KiroAssistantResponseMessage


class ToolNameRegistry(Protocol):
    def to_kiro_name(self, name: str) -> str: ...
    def restore_tool_uses(self, tool_uses: list[KiroToolUse]) -> list[KiroToolUse]: ...


# ── Constants ────────────────────────────────────────────────────────────────

_CP: dict[str, str] = {"type": "default"}

# Reference `translator.ts`: KIRO_MAX_TOOL_DESC_LEN = 10237 (10240 minus "...").
KIRO_MAX_TOOL_DESC_LEN = 10237

_EXECUTION_DIRECTIVE = """
<execution_discipline>
When the user requests a specific task, follow this discipline:
1. **Goal locking**: keep the user's original goal in mind throughout the session; do not drift during code exploration
2. **Action priority**: prefer executing the task over merely analyzing or summarizing, unless the user explicitly asks only for analysis
3. **Plan execution**: create an explicit step-by-step plan, execute it incrementally, and mark each step complete
4. **No confirmation padding**: before the task is finished, do not ask "should I continue?" or "need deeper analysis?"
5. **Continuous progress**: if part of the task is already done, immediately proceed with the remaining steps
6. **Complete delivery**: the task is only done when every step has been executed
</execution_discipline>
"""

# ── Cache point helpers ──────────────────────────────────────────────────────


def to_kiro_cache_point(cc: dict[str, str] | None) -> dict[str, str] | None:
    if cc is None:
        return None
    if cc["type"] != "ephemeral":
        raise ValueError(f"Unsupported cache_control type: {cc['type']}")
    return _CP


def merge_cache_points(a: dict[str, str] | None, b: dict[str, str] | None) -> dict[str, str] | None:
    return a or b


# ── Image / document helpers ─────────────────────────────────────────────────


def normalize_image_format(fmt: str) -> str:
    m = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "gif": "gif", "webp": "webp"}
    n = m.get(fmt.lower())
    if n is None:
        raise ValueError(f"Unsupported image format: {fmt}")
    return n


def normalize_document_format(media_type: str | None, name: str) -> str:
    lm = (media_type or "").lower()
    if lm == "application/pdf":
        return "pdf"
    if lm == "text/markdown":
        return "md"
    if lm == "text/csv":
        return "csv"
    if lm == "text/html":
        return "html"
    if lm.startswith("text/"):
        return "txt"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return {"pdf": "pdf", "md": "md", "markdown": "md", "csv": "csv", "html": "html", "htm": "html"}.get(ext, "txt")


def parse_image_url(url: str) -> dict[str, JsonValue] | None:
    if not url.startswith("data:image/"):
        return None
    prefix, _, b64 = url.partition(";base64,")
    if not b64:
        return None
    fmt = prefix[len("data:image/"):]
    return {"format": normalize_image_format(fmt), "source": {"bytes": b64}}


def parse_claude_document_source(source: dict[str, str], name: str) -> dict[str, JsonValue]:
    if source["type"] == "base64":
        return {"format": normalize_document_format(source["media_type"], name), "name": name, "source": {"bytes": source["data"]}}
    if source["type"] == "text":
        b64 = base64.b64encode(source["data"].encode()).decode()
        return {"format": normalize_document_format(source.get("media_type"), name), "name": name, "source": {"bytes": b64}}
    raise ValueError(f"Unsupported document source type: {source['type']}")
