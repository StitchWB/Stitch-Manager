from __future__ import annotations

import json
from dataclasses import dataclass
from enum import StrEnum

from stitch_backend.domains.ai_proxy.holone_inspector import Finding, Severity, default_engine


class SecurityMode(StrEnum):
    MONITOR = "monitor"
    BLOCK = "block"


@dataclass(frozen=True, slots=True)
class ProtectionResult:
    body: str
    findings: tuple[Finding, ...]
    blocked: bool


def protect_openai_response(
    payload: dict, *, mode: SecurityMode, client_has_tools: bool
) -> tuple[dict, tuple[Finding, ...], bool]:
    findings: list[Finding] = []
    saw_tool = False
    choices = payload.get("choices")
    if not isinstance(choices, list):
        return payload, (), False
    for choice in choices:
        message = choice.get("message") if isinstance(choice, dict) else None
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if isinstance(content, str):
            findings.extend(default_engine().inspect(content, source="text"))
        calls = message.get("tool_calls")
        if not isinstance(calls, list):
            continue
        for call in calls:
            function = call.get("function") if isinstance(call, dict) else None
            if not isinstance(function, dict):
                continue
            saw_tool = True
            arguments = function.get("arguments")
            if isinstance(arguments, str):
                findings.extend(
                    default_engine().inspect(
                        arguments,
                        source=f"tool_call:{function.get('name', '')}",
                    )
                )
    if saw_tool and not client_has_tools:
        findings.append(_unsolicited("tool_call"))
    drop = saw_tool and (
        not client_has_tools or any(item.severity is Severity.HIGH for item in findings)
    )
    if mode is SecurityMode.MONITOR or not drop:
        return payload, tuple(findings), False

    reason = _block_reason(findings)
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message")
        if not isinstance(message, dict) or "tool_calls" not in message:
            continue
        message.pop("tool_calls", None)
        content = message.get("content")
        prefix = content if isinstance(content, str) else ""
        message["content"] = f"{prefix}[holone blocked a suspicious tool call: {reason}]"
        choice["finish_reason"] = "stop"
    return payload, tuple(findings), True


def protect_anthropic_response(
    payload: dict, *, mode: SecurityMode, client_has_tools: bool
) -> tuple[dict, tuple[Finding, ...], bool]:
    """Protect non-stream Anthropic Messages API responses."""
    findings: list[Finding] = []
    saw_tool = False
    content = payload.get("content")
    if not isinstance(content, list):
        return payload, (), False
    
    for block in content:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "text":
            text = block.get("text")
            if isinstance(text, str):
                findings.extend(default_engine().inspect(text, source="text"))
        elif block_type == "tool_use":
            saw_tool = True
            name = block.get("name", "")
            input_data = block.get("input")
            if isinstance(input_data, dict):
                findings.extend(
                    default_engine().inspect(
                        json.dumps(input_data),
                        source=f"tool_use:{name}",
                    )
                )
    
    if saw_tool and not client_has_tools:
        findings.append(_unsolicited("tool_use"))
    
    drop = saw_tool and (
        not client_has_tools or any(item.severity is Severity.HIGH for item in findings)
    )
    if mode is SecurityMode.MONITOR or not drop:
        return payload, tuple(findings), False
    
    reason = _block_reason(findings)
    new_content = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            continue
        new_content.append(block)
    new_content.append({"type": "text", "text": f"[holone blocked a suspicious tool call: {reason}]"})
    payload["content"] = new_content
    if payload.get("stop_reason") == "tool_use":
        payload["stop_reason"] = "end_turn"
    return payload, tuple(findings), True


@dataclass(frozen=True, slots=True)
class _Frame:
    raw: str
    event: str
    data: str


def protect_openai_sse(
    body: str, *, mode: SecurityMode, client_has_tools: bool
) -> ProtectionResult:
    frames = _frames(body)
    findings: list[Finding] = []
    arguments: dict[int, str] = {}
    names: dict[int, str] = {}
    saw_tool = False
    finished_indexes: set[int] = set()
    arg_sizes: dict[int, int] = {}
    inspection_cap = 1048576  # 1 MiB

    for frame in frames:
        payload = _json(frame.data)
        choices = payload.get("choices") if payload else None
        if not isinstance(choices, list):
            continue
        for choice in choices:
            if isinstance(choice, dict) and choice.get("finish_reason") in ("tool_calls", "stop"):
                for call in (choice.get("delta", {}).get("tool_calls") or []):
                    if isinstance(call, dict):
                        idx = call.get("index", 0)
                        if isinstance(idx, int):
                            finished_indexes.add(idx)
            delta = choice.get("delta") if isinstance(choice, dict) else None
            calls = delta.get("tool_calls") if isinstance(delta, dict) else None
            if not isinstance(calls, list):
                continue
            for call in calls:
                function = call.get("function") if isinstance(call, dict) else None
                index = call.get("index", 0) if isinstance(call, dict) else 0
                if not isinstance(function, dict) or not isinstance(index, int):
                    continue
                saw_tool = True
                name = function.get("name")
                fragment = function.get("arguments")
                if isinstance(name, str) and name:
                    names[index] = name
                if isinstance(fragment, str):
                    current_size = arg_sizes.get(index, 0)
                    if current_size < inspection_cap:
                        remaining = inspection_cap - current_size
                        if len(fragment) > remaining:
                            fragment = fragment[:remaining]
                            findings.append(Finding(
                                rule_id="inspection-truncated",
                                category="protocol",
                                severity=Severity.LOW,
                                match=f"tool_call:{index} truncated at 1 MiB",
                                excerpt="",
                                source=f"tool_call:{names.get(index, '')}",
                                description="Tool call arguments exceeded 1 MiB inspection buffer",
                            ))
                        arguments[index] = arguments.get(index, "") + fragment
                        arg_sizes[index] = current_size + len(fragment)

    for index, value in arguments.items():
        findings.extend(default_engine().inspect(value, source=f"tool_call:{names.get(index, '')}"))
    if saw_tool and not client_has_tools:
        findings.append(_unsolicited("tool_call"))

    drop = saw_tool and (
        not client_has_tools or any(item.severity is Severity.HIGH for item in findings)
    )
    if mode is SecurityMode.MONITOR or not drop:
        return ProtectionResult(body, tuple(findings), False)

    reason = _block_reason(findings)
    output: list[str] = []
    finished = False
    for frame in frames:
        payload = _json(frame.data)
        choices = payload.get("choices") if payload else None
        choice = choices[0] if isinstance(choices, list) and choices else None
        delta = choice.get("delta") if isinstance(choice, dict) else None
        calls = delta.get("tool_calls") if isinstance(delta, dict) else None
        if isinstance(calls, list) and calls:
            content = delta.get("content") if isinstance(delta, dict) else None
            if isinstance(content, str) and content:
                output.append(_openai_content(content))
            continue
        if isinstance(choice, dict) and choice.get("finish_reason") == "tool_calls":
            output.extend((_openai_note(reason), _openai_finish()))
            finished = True
            continue
        output.append(frame.raw)
    if not finished:
        output.extend((_openai_note(reason), _openai_finish()))
    return ProtectionResult("".join(output), tuple(findings), True)


def protect_anthropic_sse(
    body: str, *, mode: SecurityMode, client_has_tools: bool
) -> ProtectionResult:
    frames = _frames(body)
    findings: list[Finding] = []
    tools: dict[int, tuple[str, str]] = {}
    active: dict[int, str] = {}
    finished_indexes: set[int] = set()
    arg_sizes: dict[int, int] = {}
    inspection_cap = 1048576  # 1 MiB

    for frame in frames:
        payload = _json(frame.data)
        if payload is None:
            continue
        event_type = payload.get("type")
        index = payload.get("index", 0)
        if not isinstance(index, int):
            continue
        block = payload.get("content_block")
        delta = payload.get("delta")
        if event_type == "content_block_start" and isinstance(block, dict) and block.get("type") == "tool_use":
            active[index] = str(block.get("name", ""))
            tools[index] = (active[index], "")
        elif event_type == "content_block_delta" and index in tools and isinstance(delta, dict):
            fragment = delta.get("partial_json")
            if isinstance(fragment, str):
                current_size = arg_sizes.get(index, 0)
                if current_size < inspection_cap:
                    remaining = inspection_cap - current_size
                    if len(fragment) > remaining:
                        fragment = fragment[:remaining]
                        findings.append(Finding(
                            rule_id="inspection-truncated",
                            category="protocol",
                            severity=Severity.LOW,
                            match=f"tool_use:{index} truncated at 1 MiB",
                            excerpt="",
                            source=f"tool_use:{active.get(index, '')}",
                            description="Tool use input exceeded 1 MiB inspection buffer",
                        ))
                    tools[index] = (tools[index][0], tools[index][1] + fragment)
                    arg_sizes[index] = current_size + len(fragment)
        elif event_type == "content_block_stop":
            finished_indexes.add(index)

    for name, value in tools.values():
        findings.extend(default_engine().inspect(value, source=f"tool_use:{name}"))
    if tools and not client_has_tools:
        findings.append(_unsolicited("tool_use"))

    drop = bool(tools) and (
        not client_has_tools or any(item.severity is Severity.HIGH for item in findings)
    )
    if mode is SecurityMode.MONITOR or not drop:
        return ProtectionResult(body, tuple(findings), False)

    blocked_indexes = set(tools)
    reason = _block_reason(findings)
    output: list[str] = []
    buffering: set[int] = set()
    for frame in frames:
        payload = _json(frame.data)
        if payload is None:
            output.append(frame.raw)
            continue
        event_type = payload.get("type")
        index = payload.get("index", 0)
        block = payload.get("content_block")
        if event_type == "content_block_start" and index in blocked_indexes and isinstance(block, dict) and block.get("type") == "tool_use":
            buffering.add(index)
            continue
        if index in buffering and event_type == "content_block_delta":
            continue
        if index in buffering and event_type == "content_block_stop":
            output.append(_anthropic_note(index, reason))
            buffering.remove(index)
            continue
        delta = payload.get("delta")
        if event_type == "message_delta" and isinstance(delta, dict) and delta.get("stop_reason") == "tool_use":
            delta["stop_reason"] = "end_turn"
            output.append(_event_frame(frame.event or "message_delta", payload))
            continue
        output.append(frame.raw)
    for index in buffering:
        output.append(_anthropic_note(index, reason))
    return ProtectionResult("".join(output), tuple(findings), True)


def _frames(body: str) -> list[_Frame]:
    frames: list[_Frame] = []
    for raw in body.split("\n\n"):
        if not raw:
            continue
        event = ""
        data: list[str] = []
        for line in raw.splitlines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
        frames.append(_Frame(raw=f"{raw}\n\n", event=event, data="\n".join(data)))
    return frames


def _json(data: str) -> dict | None:
    if not data or data == "[DONE]":
        return None
    try:
        value = json.loads(data)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _unsolicited(source: str) -> Finding:
    return Finding(
        rule_id="proto-tooluse-unsolicited",
        category="protocol",
        severity=Severity.HIGH,
        match="tool call without advertised tools",
        excerpt="tool call without advertised tools",
        source=source,
        description="Provider returned a tool call although the client advertised no tools",
    )


def _block_reason(findings: list[Finding]) -> str:
    for finding in findings:
        if finding.rule_id != "proto-tooluse-unsolicited":
            return finding.rule_id
    return "unsolicited tool call"


def _data_frame(payload: dict) -> str:
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n"


def _openai_content(content: str) -> str:
    return _data_frame({"id": "holone", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": None}]})


def _openai_note(reason: str) -> str:
    return _openai_content(f"[holone blocked a suspicious tool call: {reason}]")


def _openai_finish() -> str:
    return _data_frame({"id": "holone", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})


def _event_frame(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


def _anthropic_note(index: int, reason: str) -> str:
    note = f"[holone blocked a suspicious tool call: {reason}]"
    return "".join((
        _event_frame("content_block_start", {"type": "content_block_start", "index": index, "content_block": {"type": "text", "text": ""}}),
        _event_frame("content_block_delta", {"type": "content_block_delta", "index": index, "delta": {"type": "text_delta", "text": note}}),
        _event_frame("content_block_stop", {"type": "content_block_stop", "index": index}),
    ))
