from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from fastapi.responses import StreamingResponse

from stitch_backend.domains.ai_proxy.litellm_response_parsing import (
    _anthropic_usage_from_sse_line,
    _tokens_from_sse_line,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Awaitable, Callable
    from typing import Any

    from stitch_backend.domains.ai_proxy.holone_service import HoloneService

logger = logging.getLogger(__name__)


def _is_error_frame(line: str) -> bool:
    """True when an SSE frame carries an upstream error despite an HTTP 200."""
    stripped = line.strip()
    if stripped.startswith("event: error"):
        return True
    if not stripped.startswith("data:"):
        return False
    payload = stripped[len("data:"):].strip()
    if payload in ("", "[DONE]"):
        return False
    try:
        parsed = json.loads(payload)
    except ValueError:
        return False
    return isinstance(parsed, dict) and "error" in parsed


async def prime_stream(response: Any) -> AsyncIterator[str]:
    """Pull the first non-empty upstream line before the client stream opens.

    Streaming adapters open the upstream connection lazily, so a 429/5xx/
    timeout surfaces only on the first pull.  Pulling here lets the executor
    fail over to the next candidate instead of aborting an SSE stream that
    already sent 200 to the client.  An error frame delivered as the first
    line (HTTP 200 + SSE error) is raised for the same reason.
    """
    iterator = response.__aiter__()
    first: str | None = None
    while True:
        try:
            line = await iterator.__anext__()
        except StopAsyncIteration:
            break
        if line:
            first = line
            break

    if first is not None and _is_error_frame(first):
        raise RuntimeError(first)

    async def _replay() -> AsyncIterator[str]:
        if first is not None:
            yield first
        async for line in iterator:
            yield line

    return _replay()


def _openai_error_frame(message: str) -> str:
    payload = {"error": {"message": message, "type": "upstream_error"}}
    return f"data: {json.dumps(payload)}\n\n"


def _anthropic_error_frame(message: str) -> str:
    payload = {"type": "error", "error": {"type": "api_error", "message": message}}
    return f"event: error\ndata: {json.dumps(payload)}\n\n"


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
        try:
            async for line in response:
                if not line:
                    continue
                if line.strip() == "data: [DONE]":
                    saw_done = True
                tokens = _tokens_from_sse_line(line)
                if tokens is not None:
                    actual_tokens = max(actual_tokens or 0, tokens)
                yield f"{line}\n\n"
        except Exception:
            logger.warning("Upstream stream failed after first chunk; terminating SSE", exc_info=True)
            yield _openai_error_frame("upstream stream interrupted")
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
        try:
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
        except Exception:
            logger.warning("Upstream stream failed after first chunk; terminating SSE", exc_info=True)
            yield _anthropic_error_frame("upstream stream interrupted")
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
