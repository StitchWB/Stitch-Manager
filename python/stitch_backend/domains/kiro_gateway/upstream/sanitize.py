"""Kiro conversation sanitization — port of sanitizeConversation from reference kiroApi.ts.

Rules: relocate tool results, remove orphans, ensure message alternation,
convert tool uses/results to text when tool defs are missing.
"""

from __future__ import annotations

from stitch_backend.domains.kiro_gateway.translator.kiro_types import (
    KiroAssistantResponseMessage,
    KiroHistoryMessage,
    KiroToolResult,
    KiroToolUse,
    KiroUserInputMessage,
)

# ── Placeholder messages ─────────────────────────────────────────────────────

_HELLO: KiroHistoryMessage = KiroHistoryMessage(
    userInputMessage=KiroUserInputMessage(content="Hello", origin="AI_EDITOR"),
)
_CONTINUE: KiroHistoryMessage = KiroHistoryMessage(
    userInputMessage=KiroUserInputMessage(content="Continue", origin="AI_EDITOR"),
)
_UNDERSTOOD: KiroHistoryMessage = KiroHistoryMessage(
    assistantResponseMessage=KiroAssistantResponseMessage(content="understood"),
)


# ── Type guards ───────────────────────────────────────────────────────────────


def _is_user(msg: KiroHistoryMessage) -> bool:
    return msg.get("userInputMessage") is not None


def _is_assistant(msg: KiroHistoryMessage) -> bool:
    return msg.get("assistantResponseMessage") is not None


def _has_tool_results(msg: KiroHistoryMessage) -> bool:
    uim = msg.get("userInputMessage")
    if uim is None:
        return False
    ctx = uim.get("userInputMessageContext")
    if ctx is None:
        return False
    return bool(ctx.get("toolResults"))


def _has_tool_uses(msg: KiroHistoryMessage) -> bool:
    arm = msg.get("assistantResponseMessage")
    if arm is None:
        return False
    return bool(arm.get("toolUses"))


def _get_tool_results(msg: KiroHistoryMessage) -> list[KiroToolResult]:
    uim = msg.get("userInputMessage")
    if uim is None:
        return []
    ctx = uim.get("userInputMessageContext")
    if ctx is None:
        return []
    return ctx.get("toolResults") or []


def _get_tool_uses(msg: KiroHistoryMessage) -> list[KiroToolUse]:
    arm = msg.get("assistantResponseMessage")
    if arm is None:
        return []
    return arm.get("toolUses") or []


def _create_failed_tool_result(tool_use_id: str) -> KiroToolResult:
    return KiroToolResult(
        toolUseId=tool_use_id,
        content=[{"text": "Tool execution failed"}],
        status="error",
    )


def _create_failed_tool_use_message(tool_use_ids: list[str]) -> KiroHistoryMessage:
    return KiroHistoryMessage(
        userInputMessage=KiroUserInputMessage(
            content="",
            origin="AI_EDITOR",
            userInputMessageContext={
                "toolResults": [_create_failed_tool_result(tid) for tid in tool_use_ids],
            },
        ),
    )


# ── Sanitization pipeline ────────────────────────────────────────────────────


def _ensure_starts_with_user(messages: list[KiroHistoryMessage]) -> list[KiroHistoryMessage]:
    if not messages or _is_user(messages[0]):
        return messages
    return [_HELLO, *messages]


def _ensure_ends_with_user(messages: list[KiroHistoryMessage]) -> list[KiroHistoryMessage]:
    if not messages:
        return [_HELLO]
    if _is_user(messages[-1]):
        return messages
    return [*messages, _CONTINUE]


def _ensure_alternating(messages: list[KiroHistoryMessage]) -> list[KiroHistoryMessage]:
    if len(messages) <= 1:
        return messages
    result: list[KiroHistoryMessage] = [messages[0]]
    for msg in messages[1:]:
        prev = result[-1]
        if _is_user(prev) and _is_user(msg):
            result.append(_UNDERSTOOD)
        elif _is_assistant(prev) and _is_assistant(msg):
            result.append(_CONTINUE)
        result.append(msg)
    return result


def _remove_empty_user_messages(messages: list[KiroHistoryMessage]) -> list[KiroHistoryMessage]:
    if len(messages) <= 1:
        return messages
    first_user_idx = next((i for i, m in enumerate(messages) if _is_user(m)), -1)
    result: list[KiroHistoryMessage] = []
    for i, msg in enumerate(messages):
        if _is_assistant(msg):
            result.append(msg)
        elif _is_user(msg):
            if i == first_user_idx:
                result.append(msg)
            else:
                uim = msg.get("userInputMessage")
                has_content = bool(uim and (uim.get("content") or "").strip())
                if has_content or _has_tool_results(msg):
                    result.append(msg)
    return result


def _relocate_tool_results(messages: list[KiroHistoryMessage]) -> list[KiroHistoryMessage]:
    """Move tool result messages to immediately follow their matching assistant tool-use message."""
    tool_use_idxs: list[int] = []
    result_idx_by_id: dict[str, int] = {}

    for i, msg in enumerate(messages):
        if _is_assistant(msg) and _has_tool_uses(msg):
            tool_use_idxs.append(i)
        elif _is_user(msg) and _has_tool_results(msg):
            for tr in _get_tool_results(msg):
                tid = tr.get("toolUseId")
                if tid and tid not in result_idx_by_id:
                    result_idx_by_id[tid] = i

    if not tool_use_idxs:
        return messages

    result: list[KiroHistoryMessage] = []
    used: set[int] = set()
    for i, msg in enumerate(messages):
        if i in used:
            continue
        result.append(msg)
        used.add(i)

        if _is_assistant(msg) and _has_tool_uses(msg):
            for tu in _get_tool_uses(msg):
                tri = result_idx_by_id.get(tu.get("toolUseId", ""))
                if tri is not None and tri != i + 1 and tri not in used:
                    result.append(messages[tri])
                    used.add(tri)

    return result


def _remove_invalid_tool_results(messages: list[KiroHistoryMessage]) -> list[KiroHistoryMessage]:
    result: list[KiroHistoryMessage] = []
    for i, msg in enumerate(messages):
        if not _is_user(msg) or not _has_tool_results(msg):
            result.append(msg)
            continue

        prev = messages[i - 1] if i > 0 else None
        if not prev or not _is_assistant(prev) or not _has_tool_uses(prev):
            # No preceding tool uses → strip tool results, keep content if any
            uim = msg.get("userInputMessage")
            if uim and (uim.get("content") or "").strip():
                clean: KiroUserInputMessage = KiroUserInputMessage(
                    content=uim["content"],
                    origin=uim.get("origin", "AI_EDITOR"),
                )
                result.append(KiroHistoryMessage(userInputMessage=clean))
            continue

        valid_ids = {tu.get("toolUseId", "") for tu in _get_tool_uses(prev)}
        seen: set[str] = set()
        filtered: list[KiroToolResult] = []
        for tr in _get_tool_results(msg):
            tid = tr.get("toolUseId", "")
            if tid and tid in valid_ids and tid not in seen:
                seen.add(tid)
                filtered.append(tr)

        if len(filtered) == len(_get_tool_results(msg)):
            result.append(msg)
        elif filtered:
            uim = msg["userInputMessage"]
            new_uim: KiroUserInputMessage = KiroUserInputMessage(
                content=uim.get("content", ""),
                origin=uim.get("origin", "AI_EDITOR"),
                userInputMessageContext={
                    "toolResults": filtered,
                },
            )
            result.append(KiroHistoryMessage(userInputMessage=new_uim))
        else:
            uim = msg.get("userInputMessage")
            if uim and (uim.get("content") or "").strip():
                result.append(KiroHistoryMessage(
                    userInputMessage=KiroUserInputMessage(
                        content=uim["content"],
                        origin=uim.get("origin", "AI_EDITOR"),
                    ),
                ))

    return result


def _ensure_valid_tool_uses_and_results(messages: list[KiroHistoryMessage]) -> list[KiroHistoryMessage]:
    result: list[KiroHistoryMessage] = []
    i = 0
    while i < len(messages):
        msg = messages[i]
        result.append(msg)

        if _is_assistant(msg) and _has_tool_uses(msg):
            tool_uses = _get_tool_uses(msg)
            tool_use_ids = [tu.get("toolUseId", f"toolUse_{idx + 1}") for idx, tu in enumerate(tool_uses)]
            nxt = messages[i + 1] if i + 1 < len(messages) else None

            if not nxt or not _is_user(nxt) or not _has_tool_results(nxt):
                result.append(_create_failed_tool_use_message(tool_use_ids))
            else:
                valid_ids = set(tool_use_ids)
                seen: set[str] = set()
                existing = _get_tool_results(nxt)
                completed: list[KiroToolResult] = []
                for tr in existing:
                    tid = tr.get("toolUseId", "")
                    if tid in valid_ids and tid not in seen:
                        seen.add(tid)
                        completed.append(tr)
                for tid in tool_use_ids:
                    if tid not in seen:
                        completed.append(_create_failed_tool_result(tid))
                if completed != existing:
                    uim = nxt["userInputMessage"]
                    if uim is not None:
                        new_uim: KiroUserInputMessage = KiroUserInputMessage(
                            content=uim.get("content", ""),
                            origin=uim.get("origin", "AI_EDITOR"),
                            userInputMessageContext={
                                "toolResults": completed,
                            },
                        )
                        result.append(KiroHistoryMessage(userInputMessage=new_uim))
                        i += 1
        i += 1
    return result


def _validate(messages: list[KiroHistoryMessage]) -> list[str]:
    errors: list[str] = []
    if not messages or not _is_user(messages[0]):
        errors.append("STARTS_WITH_USER_MESSAGE:index=0")
    if not messages or not _is_user(messages[-1]):
        errors.append(f"ENDS_WITH_USER_MESSAGE:index={max(len(messages) - 1, 0)}")
    for i in range(1, len(messages)):
        prev = messages[i - 1]
        cur = messages[i]
        if _is_user(prev) and _is_user(cur):
            errors.append(f"ALTERNATING_MESSAGES:index={i}")
            break
        if _is_assistant(prev) and _is_assistant(cur):
            errors.append(f"ALTERNATING_MESSAGES:index={i}")
            break
    return errors


def sanitize_conversation(messages: list[KiroHistoryMessage]) -> list[KiroHistoryMessage]:
    """Apply Kiro-official history sanitization rules.

    Pipeline: ensure_start → remove_empty → relocate_tool_results →
    remove_invalid_tool_results → ensure_valid_tool_uses_and_results →
    ensure_alternating → ensure_end → validate.
    """
    sanitized = list(messages)
    sanitized = _ensure_starts_with_user(sanitized)
    sanitized = _remove_empty_user_messages(sanitized)
    sanitized = _relocate_tool_results(sanitized)
    sanitized = _remove_invalid_tool_results(sanitized)
    sanitized = _ensure_valid_tool_uses_and_results(sanitized)
    sanitized = _ensure_alternating(sanitized)
    sanitized = _ensure_ends_with_user(sanitized)
    errors = _validate(sanitized)
    if errors:
        raise ValueError(f"Invalid Kiro conversation after sanitization: {', '.join(errors)}")
    return sanitized
