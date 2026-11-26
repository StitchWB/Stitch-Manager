"""Session-hint extraction for the OpenAI-compatible AI gateway.

This module intentionally does not import or depend on ``kiro_gateway``: the
Kiro implementation is a useful reference, but the domains must stay
uncoupled.  The helper only extracts a client-supplied/fallback hint.  It is
used as in-memory routing state and must never be forwarded upstream.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Mapping

_MESSAGE_TRUNCATE = 512
_HEADER_CANDIDATES = (
    "x-opencode-session",
    "x-session-affinity",
    "x-conversation-id",
    "x-claude-code-session-id",
)
_BODY_CANDIDATES = (
    "prompt_cache_key",
    "promptCacheKey",
    "conversation_id",
    "conversationId",
    "thread_id",
    "threadId",
    "session_id",
    "sessionId",
)


def _nonempty_str(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _body_str(body: Mapping[str, Any], key: str) -> str | None:
    return _nonempty_str(body.get(key))


def _content_text(content: Any) -> str | None:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            text = part.get("text")
            if isinstance(text, str):
                parts.append(text)
                continue
            # OpenAI content parts commonly nest text as
            # ``{"type": "text", "text": "..."}`` while Anthropic-shaped
            # callers may use other text-bearing keys.
            nested = part.get("content")
            if isinstance(nested, str):
                parts.append(nested)
        return "".join(parts) if parts else None
    return None


def _first_user_content(messages: Any) -> str | None:
    if not isinstance(messages, list):
        return None
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        return _content_text(message.get("content"))
    return None


def _responses_input_content(value: Any) -> str | None:
    """Best-effort first-user text for the Responses API ``input`` shapes."""
    if isinstance(value, str):
        return value
    if not isinstance(value, list):
        return None
    for item in value:
        if not isinstance(item, dict):
            continue
        if item.get("role") == "user":
            text = _content_text(item.get("content"))
            if text:
                return text
        # Some clients use the output-item shape even on input.
        if item.get("type") in {"message", "input_text"}:
            text = _content_text(item.get("content") or item.get("text"))
            if text:
                return text
    return None


def _fingerprint(text: str) -> str:
    return "fp:" + hashlib.sha256(text[:_MESSAGE_TRUNCATE].encode("utf-8")).hexdigest()


def extract_session_hint(
    headers: Mapping[str, str],
    body: Mapping[str, Any],
) -> str | None:
    """Extract a stable session hint using the spec's precedence order.

    Precedence: explicit headers → top-level body identifiers →
    ``metadata.session_id``/conversation id → explicit ``user`` → a bounded
    fingerprint of the first user message.  Header lookup is case-insensitive
    because ASGI clients may preserve either casing.
    """
    normalized_headers = {str(key).lower(): value for key, value in headers.items()}
    for name in _HEADER_CANDIDATES:
        hint = _nonempty_str(normalized_headers.get(name))
        if hint:
            return hint

    for name in _BODY_CANDIDATES:
        hint = _body_str(body, name)
        if hint:
            return hint

    metadata = body.get("metadata")
    if isinstance(metadata, dict):
        for name in ("session_id", "sessionId", "conversation_id", "conversationId"):
            hint = _body_str(metadata, name)
            if hint:
                return hint

    user = _nonempty_str(body.get("user"))
    if user:
        return user

    content = _first_user_content(body.get("messages"))
    if content is None:
        content = _responses_input_content(body.get("input"))
    if content:
        return _fingerprint(content)
    return None
