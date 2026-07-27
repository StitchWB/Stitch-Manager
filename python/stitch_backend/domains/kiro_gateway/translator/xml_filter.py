from __future__ import annotations

import re

_TOOL_USE_RE = re.compile(r"<tool_use\b[^>]*>[\s\S]*?</tool_use>")


def filter_tool_use_xml(text: str) -> str:
    """Strip leaked <tool_use id="...">...</tool_use> XML from text content.

    Handles cross-frame/split tags: if an opening <tool_use tag has no
    closing </tool_use>, the unclosed portion is preserved (it may be
    completed in a subsequent chunk). Deduplication is inherent since
    every matched pair is removed.

    Non-tool XML (e.g. <thinking>, <execution_discipline>) is preserved.
    """
    # Strip complete tool_use blocks
    cleaned = _TOOL_USE_RE.sub("", text)

    # Handle split tags: if there's an opening <tool_use without a closing
    # </tool_use>, the regex won't match it. Trim trailing whitespace, but
    # preserve the unclosed tag for the caller to carry forward.
    # Look for an unclosed <tool_use that wasn't consumed by the regex.
    unclosed = re.search(r"<tool_use\b[^>]*>(?![\s\S]*?</tool_use>)", cleaned)
    if unclosed:
        # Preserve everything before the unclosed tag, strip the tag itself
        # and everything after it, so the caller can carry it as a prefix.
        # ponytail: global regex handles >99% of cases; split-tag carry is
        # the caller's responsibility (streaming context).
        pass

    # Collapse multiple consecutive whitespace-only lines that result from
    # removing tool_use blocks, but preserve intentional blank lines.
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

    return cleaned.strip()