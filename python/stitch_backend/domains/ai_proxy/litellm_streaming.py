from __future__ import annotations

import asyncio
import inspect
import json
import logging
import time
from typing import TYPE_CHECKING

from fastapi.responses import StreamingResponse

from stitch_backend.domains.ai_proxy.litellm_response_parsing import (
    _anthropic_usage_from_sse_line,
    _usage_split_from_sse_line,
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


def _sse_json(line: str) -> dict[str, Any] | None:
    stripped = line.strip()
    if not stripped.startswith("data:"):
        return None
    payload = stripped[len("data:"):].strip()
    if payload in ("", "[DONE]"):
        return None
    try:
        parsed = json.loads(payload)
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _openai_frame_has_content(line: str) -> bool:
    """True when an OpenAI-shaped chunk carries answer content or a tool call."""
    data = _sse_json(line)
    if data is None:
        return False
    choices = data.get("choices")
    if not isinstance(choices, list):
        return False
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        delta = choice.get("delta")
        if not isinstance(delta, dict):
            delta = choice.get("message")
        if isinstance(delta, dict) and (
            delta.get("content")
            or delta.get("tool_calls")
            or delta.get("reasoning_content")
            or delta.get("reasoning")
        ):
            return True
        if choice.get("text"):
            return True
    return False


def _anthropic_frame_has_content(line: str) -> bool:
    """True when an Anthropic-shaped event carries answer content/tool input."""
    data = _sse_json(line)
    if data is None:
        return False
    event_type = data.get("type")
    if event_type == "content_block_delta":
        delta = data.get("delta")
        if not isinstance(delta, dict):
            return False
        # text/thinking are user-visible content; partial_json is tool-call input.
        return bool(
            delta.get("text")
            or delta.get("thinking")
            or delta.get("partial_json")
        )
    if event_type == "content_block_start":
        block = data.get("content_block")
        if not isinstance(block, dict):
            return False
        return bool(block.get("text") or block.get("type") == "tool_use")
    return False


def _callback_accepts_failure_reason(callback: Callable[..., Awaitable[None]]) -> bool:
    try:
        signature = inspect.signature(callback)
    except (TypeError, ValueError):
        return False
    positional = 0
    for parameter in signature.parameters.values():
        if parameter.kind == inspect.Parameter.VAR_POSITIONAL:
            return True
        if parameter.kind in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        ):
            positional += 1
    return positional >= 3


async def notify_stream_complete(
    callback: Callable[..., Awaitable[None]] | None,
    usage: tuple[int, int] | None,
    ok: bool,
    failure_reason: str | None = None,
) -> None:
    """Invoke the completion callback, preserving the legacy two-arg contract.

    New pipeline callbacks opt into a third failure-reason argument.  Older
    tests/embedders with ``(usage, ok)`` continue to receive exactly that.
    """
    if callback is None:
        return
    if failure_reason is not None and _callback_accepts_failure_reason(callback):
        await callback(usage, ok, failure_reason)
    else:
        await callback(usage, ok)


class TtftWatchdogError(RuntimeError):
    """The first meaningful upstream frame did not arrive in time.

    Raised before any byte reached the client, so the executor may fail over
    to the next candidate transparently.  This is a *slowness* signal, not a
    health signal: it must never mark ``CredentialModelAccess`` unavailable or
    feed credential/endpoint failure counters.
    """


class StreamStallError(RuntimeError):
    """Silence on an upstream stream exceeded the stall budget.

    Before the first frame this behaves like the TTFT watchdog (failover, no
    health recording).  After the first frame the client already holds bytes,
    so failover is impossible — the stream aborts and the stall is recorded as
    a model-level reliability failure.
    """


async def prime_stream(
    response: Any,
    *,
    first_frame_timeout: float | None = None,
    content_check: Callable[[str], bool] | None = None,
) -> AsyncIterator[str]:
    """Pull the first non-empty upstream line before the client stream opens.

    Streaming adapters open the upstream connection lazily, so a 429/5xx/
    timeout surfaces only on the first pull.  Pulling here lets the executor
    fail over to the next candidate instead of aborting an SSE stream that
    already sent 200 to the client.  An error frame delivered as the first
    line (HTTP 200 + SSE error) is raised for the same reason.

    When ``first_frame_timeout`` is given, the pull is budgeted: lines are
    buffered until a *meaningful* frame arrives — one passing
    ``content_check`` when provided, else the first non-empty line.  If the
    budget expires first, :class:`TtftWatchdogError` is raised while the
    client stream is still unopened, so failover stays safe.  A stream that
    ends before any content frame is not a timeout: it falls through to the
    legacy empty-stream handling.
    """
    iterator = response.__aiter__()
    buffered: list[str] = []
    deadline = (
        time.monotonic() + first_frame_timeout
        if first_frame_timeout is not None
        else None
    )
    while True:
        try:
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TtftWatchdogError(
                        "first meaningful frame did not arrive within "
                        f"{first_frame_timeout:.2f}s"
                    )
                try:
                    line = await asyncio.wait_for(iterator.__anext__(), remaining)
                except TimeoutError as exc:
                    raise TtftWatchdogError(
                        "first meaningful frame did not arrive within "
                        f"{first_frame_timeout:.2f}s"
                    ) from exc
            else:
                line = await iterator.__anext__()
        except StopAsyncIteration:
            break
        if not line:
            continue
        buffered.append(line)
        if deadline is None:
            # Legacy behavior: the first non-empty line is enough.
            break
        if content_check is None or content_check(line):
            break

    for line in buffered:
        if _is_error_frame(line):
            raise RuntimeError(line)
    if not buffered:
        raise RuntimeError("upstream returned an empty stream")

    async def _replay() -> AsyncIterator[str]:
        for line in buffered:
            yield line
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
    on_complete: Callable[[tuple[int, int] | None, bool], Awaitable[None]] | None = None,
) -> StreamingResponse:
    if holone_service.config.enabled:
        return await stream_openai_response_buffered(
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
        saw_content = False
        failed = False
        client_gone = False
        try:
            try:
                async for line in response:
                    if not line:
                        continue
                    if line.strip() == "data: [DONE]":
                        saw_done = True
                    if _openai_frame_has_content(line):
                        saw_content = True
                    usage = _usage_split_from_sse_line(line)
                    if usage is not None:
                        found_usage = True
                        input_tokens = max(input_tokens, usage[0])
                        output_tokens = max(output_tokens, usage[1])
                    yield f"{line}\n\n"
            except (GeneratorExit, asyncio.CancelledError):
                # Client disconnect/cancellation is not upstream evidence.
                # These BaseException paths bypass the broad ``except
                # Exception`` below, so without this the finally block would
                # report a false ``empty_completion`` model mark for a stream
                # the client simply walked away from before the first byte.
                client_gone = True
                raise
            except Exception:
                failed = True
                logger.warning("Upstream stream failed after first chunk; terminating SSE", exc_info=True)
                yield _openai_error_frame("upstream stream interrupted")
            if not saw_done:
                yield "data: [DONE]\n\n"
        finally:
            # Outcome semantics:
            #   upstream error          → stream_interrupted (failure)
            #   no content, no error,
            #     stream consumed       → empty_completion (model-level failure)
            #   client disconnect       → never empty: after content it is a
            #                             successful delivery as far as observed
            #                             (usage still counts); before the first
            #                             content byte the outcome is unknown —
            #                             neither a success claim nor a model mark.
            empty = not failed and not client_gone and not saw_content
            if client_gone:
                ok = saw_content
                reason = None if saw_content else "client_disconnect"
            elif failed:
                ok = False
                reason = "stream_interrupted"
            elif empty:
                ok = False
                reason = "empty_completion"
            else:
                ok = True
                reason = None
            await notify_stream_complete(
                on_complete,
                (input_tokens, output_tokens) if found_usage else None,
                ok,
                reason,
            )

    return StreamingResponse(body_gen(), media_type="text/event-stream")


async def stream_openai_response_buffered(
    response: Any,
    *,
    holone_service: HoloneService,
    client_has_tools: bool,
    on_complete: Callable[[tuple[int, int] | None, bool], Awaitable[None]] | None,
) -> StreamingResponse:
    lines: list[str] = []
    input_tokens = 0
    output_tokens = 0
    found_usage = False
    saw_content = False
    async for line in response:
        if not line or line.strip() == "data: [DONE]":
            continue
        lines.append(line)
        if _openai_frame_has_content(line):
            saw_content = True
        usage = _usage_split_from_sse_line(line)
        if usage is not None:
            found_usage = True
            input_tokens = max(input_tokens, usage[0])
            output_tokens = max(output_tokens, usage[1])

    body = "".join(f"{line}\n\n" for line in lines) + "data: [DONE]\n\n"
    result = holone_service.inspect_stream_openai(body, client_has_tools=client_has_tools)
    if result.findings:
        logger.info("HoloNe stream findings: %s (blocked=%s)", [f.rule_id for f in result.findings], result.blocked)
    body = result.body

    async def body_gen():
        yield body.encode("utf-8")
        await notify_stream_complete(
            on_complete,
            (input_tokens, output_tokens) if found_usage else None,
            saw_content,
            None if saw_content else "empty_completion",
        )

    return StreamingResponse(body_gen(), media_type="text/event-stream")


async def stream_anthropic_response(
    response: Any,
    *,
    holone_service: HoloneService,
    client_has_tools: bool = False,
    on_complete: Callable[[tuple[int, int] | None, bool], Awaitable[None]] | None = None,
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
        saw_content = False
        failed = False
        client_gone = False
        try:
            try:
                async for line in response:
                    if not line:
                        continue
                    if line.strip() == "data: [DONE]":
                        saw_done = True
                    if _anthropic_frame_has_content(line):
                        saw_content = True
                    usage = _anthropic_usage_from_sse_line(line)
                    if usage is not None:
                        found_usage = True
                        input_tokens = max(input_tokens, usage[0])
                        output_tokens = max(output_tokens, usage[1])
                    yield f"{line}\n\n"
            except (GeneratorExit, asyncio.CancelledError):
                # Client disconnect/cancellation is not upstream evidence —
                # see the OpenAI variant above.
                client_gone = True
                raise
            except Exception:
                failed = True
                logger.warning("Upstream stream failed after first chunk; terminating SSE", exc_info=True)
                yield _anthropic_error_frame("upstream stream interrupted")
            if not saw_done:
                yield "data: [DONE]\n\n"
        finally:
            # Outcome semantics:
            #   upstream error          → stream_interrupted (failure)
            #   no content, no error,
            #     stream consumed       → empty_completion (model-level failure)
            #   client disconnect       → never empty: after content it is a
            #                             successful delivery as far as observed
            #                             (usage still counts); before the first
            #                             content byte the outcome is unknown —
            #                             neither a success claim nor a model mark.
            empty = not failed and not client_gone and not saw_content
            if client_gone:
                ok = saw_content
                reason = None if saw_content else "client_disconnect"
            elif failed:
                ok = False
                reason = "stream_interrupted"
            elif empty:
                ok = False
                reason = "empty_completion"
            else:
                ok = True
                reason = None
            await notify_stream_complete(
                on_complete,
                (input_tokens, output_tokens) if found_usage else None,
                ok,
                reason,
            )

    return StreamingResponse(body_gen(), media_type="text/event-stream")


async def stream_anthropic_response_buffered(
    response: Any,
    *,
    holone_service: HoloneService,
    client_has_tools: bool,
    on_complete: Callable[[tuple[int, int] | None, bool], Awaitable[None]] | None,
) -> StreamingResponse:
    lines: list[str] = []
    input_tokens = 0
    output_tokens = 0
    found_usage = False
    saw_content = False
    async for line in response:
        if not line or line.strip() == "data: [DONE]":
            continue
        lines.append(line)
        if _anthropic_frame_has_content(line):
            saw_content = True
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
        await notify_stream_complete(
            on_complete,
            (input_tokens, output_tokens) if found_usage else None,
            saw_content,
            None if saw_content else "empty_completion",
        )

    return StreamingResponse(body_gen(), media_type="text/event-stream")
