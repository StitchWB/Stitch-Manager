"""OpenAI Responses API ↔ Chat Completions conversion (translator layer)."""

from __future__ import annotations

import uuid

from stitch_backend.domains.kiro_gateway.translator.kiro_types import JsonObject, JsonValue
from stitch_backend.domains.kiro_gateway.translator.openai_types import (
    OpenAIChatRequest,
    OpenAIChatResponse,
    OpenAIMessage,
    OpenAIResponsesRequest,
    OpenAIResponsesResponse,
)


def _convert_response_input_content(
    content: str | list[JsonObject] | None,
) -> str | list[JsonObject] | None:
    if isinstance(content, str):
        return content
    if content is None:
        return ""
    if not isinstance(content, list):
        raise ValueError("message content must be a string or an array")
    parts: list[JsonObject] = []
    for part in content:
        ptype = str(part.get("type", ""))
        if ptype == "input_image":
            if not part.get("image_url"):
                raise ValueError("input_image requires image_url")
            parts.append({"type": "image_url", "image_url": {"url": part["image_url"]}})
        elif ptype == "input_file":
            if not part.get("file_data"):
                raise ValueError("input_file requires file_data")
            file_part: JsonObject = {
                "type": "file",
                "file": {"file_data": part["file_data"]},
            }
            if part.get("filename") is not None:
                file_part["file"]["filename"] = part["filename"]
            parts.append(file_part)
        elif ptype not in ("input_text", "output_text"):
            raise ValueError(f"Unsupported responses content part type: {ptype}")
        else:
            if part.get("text") is None:
                raise ValueError(f"{ptype} requires text")
            parts.append({"type": "text", "text": part["text"]})
    return parts


def _convert_response_tool_choice(
    tool_choice: str | dict[str, JsonValue] | None,
) -> str | dict[str, JsonValue] | None:
    if not tool_choice or isinstance(tool_choice, str):
        return tool_choice
    if isinstance(tool_choice, dict):
        tc_type = tool_choice.get("type")
        if tc_type in ("none", "auto"):
            return str(tc_type)
        if tc_type == "function" and tool_choice.get("name"):
            return {"type": "function", "function": {"name": tool_choice["name"]}}
        fn = tool_choice.get("function")
        if isinstance(fn, dict) and fn.get("name"):
            return {"type": "function", "function": {"name": fn["name"]}}
    raise ValueError("Unsupported responses tool_choice")


def responses_to_openai_chat(request: OpenAIResponsesRequest) -> OpenAIChatRequest:
    """Convert OpenAI Responses API request to Chat Completions request."""
    if not isinstance(request, dict):
        raise ValueError("Responses request body must be an object")
    if not request.get("model"):
        raise ValueError("Responses request requires model")
    if "input" not in request:
        raise ValueError("Responses request requires input")

    messages: list[OpenAIMessage] = []
    if request.get("instructions"):
        messages.append(OpenAIMessage(role="system", content=request["instructions"]))

    req_input = request["input"]
    if isinstance(req_input, str):
        messages.append(OpenAIMessage(role="user", content=req_input))
    else:
        if not isinstance(req_input, list):
            raise ValueError("Responses input must be a string or an array")
        for item in req_input:
            item_type = str(item.get("type", ""))
            if item_type == "function_call_output":
                if not item.get("call_id"):
                    raise ValueError("function_call_output requires call_id")
                if item.get("output") is None:
                    raise ValueError("function_call_output requires output")
                messages.append(
                    OpenAIMessage(
                        role="tool",
                        content=str(item["output"]),
                        tool_call_id=str(item["call_id"]),
                    )
                )
            elif item_type == "function_call":
                if not item.get("call_id"):
                    raise ValueError("function_call requires call_id")
                if not item.get("name"):
                    raise ValueError("function_call requires name")
                if item.get("arguments") is None:
                    raise ValueError("function_call requires arguments")
                messages.append(
                    OpenAIMessage(
                        role="assistant",
                        content="",
                        tool_calls=[{
                            "id": str(item["call_id"]),
                            "type": "function",
                            "function": {
                                "name": str(item["name"]),
                                "arguments": str(item["arguments"]),
                            },
                        }],
                    )
                )
            else:
                if item_type not in ("", "message"):
                    raise ValueError(f"Unsupported responses input item type: {item_type}")
                if item.get("content") is None:
                    raise ValueError("message input item requires content")
                role = str(item.get("role", "user"))
                mapped_role = (
                    "assistant" if role == "assistant"
                    else "system" if role == "system"
                    else "user"
                )
                messages.append(
                    OpenAIMessage(
                        role=mapped_role,
                        content=_convert_response_input_content(item["content"]),
                    )
                )

    chat: OpenAIChatRequest = OpenAIChatRequest(model=request["model"], messages=messages)
    if request.get("temperature") is not None:
        chat["temperature"] = request["temperature"]
    if request.get("top_p") is not None:
        chat["top_p"] = request["top_p"]
    if request.get("max_output_tokens") is not None:
        chat["max_tokens"] = request["max_output_tokens"]
    if request.get("stream") is not None:
        chat["stream"] = request["stream"]
    if request.get("tools") is not None:
        chat["tools"] = request["tools"]
    tc = _convert_response_tool_choice(request.get("tool_choice"))
    if tc is not None:
        chat["tool_choice"] = tc
    if request.get("previous_response_id") is not None:
        chat["conversation_id"] = request["previous_response_id"]
    if request.get("metadata") is not None:
        chat["metadata"] = request["metadata"]
    if request.get("kiro_context") is not None:
        chat["kiro_context"] = request["kiro_context"]
    return chat


def openai_chat_to_responses_response(
    response: OpenAIChatResponse,
    previous_response_id: str | None = None,
) -> OpenAIResponsesResponse:
    """Convert OpenAI Chat Completions response to Responses API response."""
    output: list[JsonObject] = []
    for choice in response.get("choices", []):
        msg = choice.get("message", {})
        tool_calls = msg.get("tool_calls")
        if isinstance(tool_calls, list) and len(tool_calls) > 0:
            for tc in tool_calls:
                fn = tc.get("function", {})
                output.append({
                    "type": "function_call",
                    "id": f"fc_{uuid.uuid4()}",
                    "call_id": tc.get("id", ""),
                    "name": fn.get("name", ""),
                    "arguments": fn.get("arguments", ""),
                })
        else:
            output.append({
                "type": "message",
                "id": f"msg_{uuid.uuid4()}",
                "role": "assistant",
                "content": [{"type": "output_text", "text": msg.get("content", "") or ""}],
            })

    usage_raw = response.get("usage", {})
    usage: JsonObject = {
        "input_tokens": usage_raw.get("prompt_tokens", 0),
        "output_tokens": usage_raw.get("completion_tokens", 0),
        "total_tokens": usage_raw.get("total_tokens", 0),
    }
    prompt_details = usage_raw.get("prompt_tokens_details")
    if isinstance(prompt_details, dict) and prompt_details.get("cached_tokens") is not None:
        usage["input_tokens_details"] = {"cached_tokens": prompt_details["cached_tokens"]}
    completion_details = usage_raw.get("completion_tokens_details")
    if isinstance(completion_details, dict) and completion_details.get("reasoning_tokens") is not None:
        usage["output_tokens_details"] = {"reasoning_tokens": completion_details["reasoning_tokens"]}

    result: OpenAIResponsesResponse = OpenAIResponsesResponse(
        id=f"resp_{uuid.uuid4()}",
        object="response",
        created_at=response.get("created", 0),
        model=response.get("model", ""),
        output=output,
        usage=usage,
    )
    if previous_response_id is not None:
        result["previous_response_id"] = previous_response_id
    return result
