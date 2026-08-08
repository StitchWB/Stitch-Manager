from __future__ import annotations

import copy
import re
from typing import Any

JsonScalar = str | int | float | bool | None
JsonValue = Any
JsonObject = dict[str, Any]

# ponytail: 10240 matches the task spec; reference uses 10237 but the difference
# is negligible and this is the contract the sibling translators compile against.
_MAX_TOOL_DESC_BYTES = 10240


def truncate_tool_descriptions(tools: list[JsonObject]) -> list[JsonObject]:
    """Truncate tool descriptions exceeding _MAX_TOOL_DESC_BYTES.

    Deep-copies the input to avoid mutating caller data. Only the
    ``description`` field inside ``function`` or ``toolSpecification``
    (or top-level ``description``) is truncated — other fields are
    passed through unchanged.

    Returns a new list of tools with truncated descriptions.
    """
    result: list[JsonObject] = []
    for tool in tools:
        tool_copy = copy.deepcopy(tool)

        # OpenAI-style: { function: { description: ... } }
        func = tool_copy.get("function")
        if isinstance(func, dict):
            _truncate_desc_in_place(func)

        # Claude-style: { description: ... }
        _truncate_desc_in_place(tool_copy)

        # Kiro-style: { toolSpecification: { description: ... } }
        spec = tool_copy.get("toolSpecification")
        if isinstance(spec, dict):
            _truncate_desc_in_place(spec)

        result.append(tool_copy)
    return result


def _truncate_desc_in_place(obj: dict[str, JsonValue]) -> None:
    desc = obj.get("description")
    if isinstance(desc, str):
        encoded = desc.encode("utf-8")
        if len(encoded) > _MAX_TOOL_DESC_BYTES:
            # Truncate to _MAX_TOOL_DESC_BYTES bytes, then append "..."
            truncated = encoded[:_MAX_TOOL_DESC_BYTES]
            # Find the last valid UTF-8 boundary
            while True:
                try:
                    obj["description"] = truncated.decode("utf-8") + "..."
                    break
                except UnicodeDecodeError:
                    truncated = truncated[:-1]


def normalize_tool_results(
    tool_results: list[JsonObject],
) -> list[JsonObject]:
    """Normalize empty/null/whitespace tool result content to "(no output)".

    Kiro backend rejects tool_result content blocks with empty or missing
    text. This function ensures every content block has a non-empty text
    field.

    Returns a new list; the input is not mutated.
    """
    result: list[JsonObject] = []
    for tr in tool_results:
        tr_copy = copy.deepcopy(tr)
        content = tr_copy.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    _normalize_content_block(block)
        result.append(tr_copy)
    return result


def _normalize_content_block(block: dict[str, JsonValue]) -> None:
    text = block.get("text")
    if text is None or (isinstance(text, str) and not text.strip()):
        block["text"] = "(no output)"


_KIRO_TOOL_NAME_MAX = 64
_FNV_OFFSET_BASIS = 2166136261
_FNV_PRIME = 16777619
_U32_MASK = 0xFFFFFFFF


def _to_base36(value: int) -> str:
    if value == 0:
        return "0"
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out: list[str] = []
    while value:
        value, rem = divmod(value, 36)
        out.append(digits[rem])
    return "".join(reversed(out))


class ToolNameRegistry:
    """Bidirectional map between client tool names and Kiro-safe (<=64 char) names.

    Port of reference `toolNameRegistry.ts`: long names are shortened with an
    FNV-1a hash suffix; collisions after shortening raise. Names are mapped
    deterministically per registry instance so responses can be restored.
    """

    def __init__(self) -> None:
        self._original_to_kiro: dict[str, str] = {}
        self._kiro_to_original: dict[str, str] = {}

    def to_kiro_name(self, name: str) -> str:
        existing = self._original_to_kiro.get(name)
        if existing is not None:
            return existing
        base = name if len(name) <= _KIRO_TOOL_NAME_MAX else self._shorten(name)
        kiro_name = self._ensure_unique(base, name)
        self._original_to_kiro[name] = kiro_name
        self._kiro_to_original[kiro_name] = name
        return kiro_name

    def to_client_name(self, name: str) -> str:
        return self._kiro_to_original.get(name, name)

    def restore_tool_use(self, tool_use: JsonObject) -> JsonObject:
        restored = dict(tool_use)
        name = restored.get("name")
        if isinstance(name, str):
            restored["name"] = self.to_client_name(name)
        return restored

    def restore_tool_uses(self, tool_uses: list[JsonObject]) -> list[JsonObject]:
        return [self.restore_tool_use(tu) for tu in tool_uses]

    def _ensure_unique(self, base: str, original: str) -> str:
        existing = self._kiro_to_original.get(base)
        if existing is None or existing == original:
            return base
        suffix = f"_{self._hash(original)}"
        candidate = base[: max(1, _KIRO_TOOL_NAME_MAX - len(suffix))] + suffix
        candidate_existing = self._kiro_to_original.get(candidate)
        if candidate_existing is None or candidate_existing == original:
            return candidate
        raise ValueError(f"Tool name collision after shortening: {original}")

    def _shorten(self, name: str) -> str:
        suffix = f"_{self._hash(name)}"
        readable = re.sub(r"[^a-zA-Z0-9_-]", "_", name)
        max_prefix = _KIRO_TOOL_NAME_MAX - len(suffix)
        return readable[:max_prefix] + suffix

    @staticmethod
    def _hash(value: str) -> str:
        h = _FNV_OFFSET_BASIS
        for ch in value:
            h = ((h ^ ord(ch)) * _FNV_PRIME) & _U32_MASK
        return _to_base36(h)


def default_tool_name_registry() -> ToolNameRegistry:
    return ToolNameRegistry()
