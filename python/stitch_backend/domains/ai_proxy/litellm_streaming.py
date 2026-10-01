from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi.responses import StreamingResponse

from stitch_backend.domains.ai_proxy.litellm_response_parsing import (
    _anthropic_usage_from_sse_line,
    _tokens_from_sse_line,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from typing import Any

    from stitch_backend.domains.ai_proxy.holone_service import HoloneService

logger = logging.getLogger(__name__)


async def stream_openai_response(
    response: Any,
    *,
    holone_service: HoloneService,
    client_has_tools: bool = False,
    on_complete: Callable[[int | None], Awaitable[None]] | None = None,
) -> StreamingResponse:
    if holone_service.config.enabled:
        return await stream_openai_response_buffered(
            response,
            holone_service=holone_service,
            client_has_tools=client_has_tools,
            on_complete=on_complete,
        )

    actual_tokens: int | None = None

    async def body_gen():
        nonlocal actual_tokens
        saw_done = False
        async for line in response:
            if not line:
                continue
            if line.strip() == "data: [DONE]":
                saw_done = True
            tokens = _tokens_from_sse_line(line)
            if tokens is not None:
                actual_tokens = max(actual_tokens or 0, tokens)
            yield f"{line}\n\n"
        if not saw_done:
            yield "data: [DONE]\n\n"
        if on_complete is not None:
            await on_complete(actual_tokens)

    return StreamingResponse(body_gen(), media_type="text/event-stream")


async def stream_openai_response_buffered(
    response: Any,
    *,
    holone_service: HoloneService,
    client_has_tools: bool,
    on_complete: Callable[[int | None], Awaitable[None]] | None,
) -> StreamingResponse:
    lines: list[str] = []
    actual_tokens: int | None = None
    async for line in response:
        if not line or line.strip() == "data: [DONE]":
            continue
        lines.append(line)
        tokens = _tokens_from_sse_line(line)
        if tokens is not None:
            actual_tokens = max(actual_tokens or 0, tokens)

    body = "".join(f"{line}\n\n" for line in lines) + "data: [DONE]\n\n"
    result = holone_service.inspect_stream_openai(body, client_has_tools=client_has_tools)
    if result.findings:
        logger.info("HoloNe stream findings: %s (blocked=%s)", [f.rule_id for f in result.findings], result.blocked)
    body = result.body

    async def body_gen():
        yield body.encode("utf-8")
        if on_complete is not None:
            await on_complete(actual_tokens)

    return StreamingResponse(body_gen(), media_type="text/event-stream")


async def stream_anthropic_response(
    response: Any,
    *,
    holone_service: HoloneService,
    client_has_tools: bool = False,
    on_complete: Callable[[int | None], Awaitable[None]] | None = None,
) -> StreamingResponse:
    if holone_service.config.enabled:
        return await stream_anthropic_response_buffered(
            response,
            holone_service=holone_service,
            client_has_tools=client_has_tools,
            on_complete=on_complete,
        )

    input_tokens = 0
    output_tokens = 0
    found_usage = False

    async def body_gen():
        nonlocal input_tokens, output_tokens, found_usage
        saw_done = False
        async for line in response:
            if not line:
                continue
            if line.strip() == "data: [DONE]":
                saw_done = True
            usage = _anthropic_usage_from_sse_line(line)
            if usage is not None:
                found_usage = True
                input_tokens = max(input_tokens, usage[0])
                output_tokens = max(output_tokens, usage[1])
            yield f"{line}\n\n"
        if not saw_done:
            yield "data: [DONE]\n\n"
        if on_complete is not None:
            total = input_tokens + output_tokens if found_usage else None
            await on_complete(total)

    return StreamingResponse(body_gen(), media_type="text/event-stream")


async def stream_anthropic_response_buffered(
    response: Any,
    *,
    holone_service: HoloneService,
    client_has_tools: bool,
    on_complete: Callable[[int | None], Awaitable[None]] | None,
) -> StreamingResponse:
    lines: list[str] = []
    input_tokens = 0
    output_tokens = 0
    found_usage = False
    async for line in response:
        if not line or line.strip() == "data: [DONE]":
            continue
        lines.append(line)
        usage = _anthropic_usage_from_sse_line(line)
        if usage is not None:
            found_usage = True
            input_tokens = max(input_tokens, usage[0])
            output_tokens = max(output_tokens, usage[1])

    body = "".join(f"{line}\n\n" for line in lines) + "data: [DONE]\n\n"
    result = holone_service.inspect_stream_anthropic(body, client_has_tools=client_has_tools)
    if result.findings:
        logger.info("HoloNe stream findings: %s (blocked=%s)", [f.rule_id for f in result.findings], result.blocked)
    body = result.body

    async def body_gen():
        yield body.encode("utf-8")
        if on_complete is not None:
            total = input_tokens + output_tokens if found_usage else None
            await on_complete(total)

    return StreamingResponse(body_gen(), media_type="text/event-stream")
