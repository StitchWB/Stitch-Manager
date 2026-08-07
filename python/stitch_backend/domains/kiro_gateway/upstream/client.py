"""Kiro CodeWhisperer upstream HTTP client (httpx, no network in tests).

Port of the reference TypeScript callKiroApi / callKiroApiStream from kiroApi.ts.
Provides:

- call_kiro_api_stream(account, payload, ...) → AsyncGenerator[ParsedEvent]
- call_kiro_api(account, payload, ...) → dict with content, toolUses, usage
- ThinkingSignatureInvalid exception + auto-retry
- Token refresh jitter hook (0-3s random delay)
- Error classification helpers
"""

from __future__ import annotations

import asyncio
import json
import random
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol, TypedDict

import httpx

from .sse import (
    ContextUsageEvent,
    ParsedEvent,
    ToolUseEvent,
    parse_event_stream,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

# ── Account protocol (minimal — sibling models.py owns the real model) ────────


class AccountLike(Protocol):
    """Minimal account shape for the HTTP client."""

    id: str
    accessToken: str
    refreshToken: str | None
    machineId: str | None
    region: str | None
    profileArn: str | None
    provider: str | None
    authMethod: str | None
    proxyUrl: str | None


# ── Exceptions ─────────────────────────────────────────────────────────────────


class KiroApiError(Exception):
    """Base for all Kiro upstream errors."""


class AuthError(KiroApiError):
    """401/403 — credentials are invalid."""


class QuotaExhaustedError(KiroApiError):
    """429 — quota exhausted."""


class PaymentRequiredError(KiroApiError):
    """402 — payment required."""


class ServerError(KiroApiError):
    """5xx — upstream server error."""


class InvalidRequestError(KiroApiError):
    """400 — malformed request payload."""


class ThinkingSignatureInvalid(KiroApiError):  # noqa: N818
    """THINKING_SIGNATURE_INVALID — retryable by stripping reasoningContent."""


class SuspendedError(KiroApiError):
    """403 + TEMPORARILY_SUSPENDED — account banned."""


# ── Usage / result types ───────────────────────────────────────────────────────


class KiroUsage(TypedDict, total=False):
    inputTokens: int
    outputTokens: int
    credits: float
    cacheReadTokens: int
    cacheWriteTokens: int
    reasoningTokens: int
    contextUsage: ContextUsageEvent


@dataclass(slots=True)
class KiroStreamResult:
    """Accumulated result from a streaming call."""

    content: str = ""
    tool_uses: list[ToolUseEvent] = field(default_factory=list)
    reasoning_text: str = ""
    reasoning_signature: str | None = None
    redacted_content: str = ""
    usage: KiroUsage = field(default_factory=lambda: KiroUsage(inputTokens=0, outputTokens=0, credits=0.0))


# ── Endpoint config ────────────────────────────────────────────────────────────


@dataclass(slots=True)
class _Endpoint:
    name: str
    url: str
    origin: str


def _get_endpoints(preferred: str | None = None) -> list[_Endpoint]:
    """Return ordered endpoint list (AmazonQ first, CodeWhisperer fallback)."""
    all_endpoints = [
        _Endpoint("AmazonQ", "https://q.us-east-1.amazonaws.com/SendMessageStreaming", "AI_EDITOR"),
        _Endpoint("CodeWhisperer", "https://codewhisperer.us-east-1.amazonaws.com/GenerateAssistantResponse", "IDE"),
    ]
    if preferred == "codewhisperer":
        all_endpoints.reverse()
    return all_endpoints


# ── Header builders ────────────────────────────────────────────────────────────


def _build_headers(account: AccountLike, endpoint: _Endpoint) -> dict[str, str]:
    """Build request headers matching the official Kiro IDE fingerprint."""
    # machine_id intentionally omitted from User-Agent — including it lets AWS
    # fingerprint and correlate requests across installations/accounts.
    request_id = str(uuid.uuid4())
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {account.accessToken}",
        "x-amz-user-agent": "aws-sdk-js/1.0.34 api/codewhisperer os/windows lang/js",
        "user-agent": "aws-sdk-js/1.0.34 os/windows lang/js",
        "amz-sdk-invocation-id": request_id,
        "amz-sdk-request": "attempt=1; max=1",
        "x-amzn-kiro-agent-mode": "vibe",
        "x-amzn-codewhisperer-optout": "true",
    }


# ── Error classification ──────────────────────────────────────────────────────


def classify_http_error(status: int, body: str) -> KiroApiError:
    """Classify an HTTP error response into a typed exception."""
    if status == 401:
        return AuthError(f"Unauthorized (401): {body[:200]}")
    if status == 403:
        if "TEMPORARILY_SUSPENDED" in body:
            return SuspendedError(f"Account suspended: {body[:200]}")
        return AuthError(f"Forbidden (403): {body[:200]}")
    if status == 429:
        return QuotaExhaustedError(f"Quota exhausted (429): {body[:200]}")
    if status == 402:
        return PaymentRequiredError(f"Payment required (402): {body[:200]}")
    if 500 <= status < 600:
        return ServerError(f"Server error ({status}): {body[:200]}")
    if status == 400:
        return InvalidRequestError(f"Bad request (400): {body[:200]}")
    return KiroApiError(f"API error {status}: {body[:200]}")


# ── Token refresh jitter ──────────────────────────────────────────────────────


async def _token_refresh_jitter() -> None:
    """Sleep 0-3s random delay before token refresh to spread load."""
    await asyncio.sleep(random.uniform(0, 3))


# ── Streaming call ─────────────────────────────────────────────────────────────


async def call_kiro_api_stream(
    account: AccountLike,
    payload: dict[str, object],
    *,
    client: httpx.AsyncClient,
    preferred_endpoint: str | None = None,
    refresh_token_hook: callable[[AccountLike], object] | None = None,
) -> AsyncGenerator[ParsedEvent, None]:
    """Stream Kiro API response, yielding parsed events from the AWS Event Stream.

    Args:
        account: Account with tokens, region, machineId, etc.
        payload: Opaque Kiro payload dict (built by upstream/payload.py).
        client: Shared httpx AsyncClient.
        preferred_endpoint: "codewhisperer" or None (AmazonQ default).
        refresh_token_hook: Optional async callable to refresh tokens before request.

    Yields:
        ParsedEvent dicts (assistantResponse, toolUse, reasoning, contextUsage, etc.)

    Raises:
        ThinkingSignatureInvalid: triggers retry with reasoningContent stripped.
        AuthError, QuotaExhaustedError, etc.
    """
    endpoints = _get_endpoints(preferred_endpoint)
    last_error: Exception | None = None

    for endpoint in endpoints:
        try:
            payload_copy = _prepare_payload(payload, account, endpoint)
            body_str = json.dumps(payload_copy)
            headers = _build_headers(account, endpoint)

            response = await client.post(
                endpoint.url,
                content=body_str.encode(),
                headers=headers,
                timeout=httpx.Timeout(120.0, connect=10.0),
            )

            if response.status_code == 429:
                last_error = QuotaExhaustedError(f"Quota exhausted on {endpoint.name}")
                continue

            if response.status_code in (401, 403):
                body = response.text
                raise classify_http_error(response.status_code, body)

            if response.status_code != 200:
                body = response.text
                raise classify_http_error(response.status_code, body)

            # Parse the AWS Event Stream binary response
            async for event in parse_event_stream(response.content):
                # Check for THINKING_SIGNATURE_INVALID in error events
                if event.get("error"):
                    err = event["error"]
                    err_msg = err.get("message", "")
                    err_reason = err.get("reason", "")
                    if "THINKING_SIGNATURE_INVALID" in err_msg or "THINKING_SIGNATURE_INVALID" in err_reason:
                        raise ThinkingSignatureInvalid(f"{err_reason}: {err_msg}")
                    raise KiroApiError(f"{err_reason}: {err_msg}")
                yield event

            return  # Success

        except (ThinkingSignatureInvalid, AuthError, QuotaExhaustedError, SuspendedError):
            raise
        except httpx.HTTPError as e:
            last_error = e
        except KiroApiError as e:
            if isinstance(e, ThinkingSignatureInvalid):
                raise
            last_error = e

    if last_error:
        raise last_error


# ── Non-streaming call ─────────────────────────────────────────────────────────


async def call_kiro_api(
    account: AccountLike,
    payload: dict[str, object],
    *,
    client: httpx.AsyncClient,
    preferred_endpoint: str | None = None,
    refresh_token_hook: callable[[AccountLike], object] | None = None,
) -> KiroStreamResult:
    """Non-streaming Kiro API call — accumulates all events into a result.

    Automatically retries once on THINKING_SIGNATURE_INVALID by stripping
    reasoningContent from history and re-sending.

    Args:
        account: Account with tokens, region, machineId, etc.
        payload: Opaque Kiro payload dict.
        client: Shared httpx AsyncClient.
        preferred_endpoint: "codewhisperer" or None.
        refresh_token_hook: Optional async callable to refresh tokens.

    Returns:
        KiroStreamResult with content, tool_uses, reasoning, usage.
    """
    try:
        return await _accumulate_stream(
            account, payload, client, preferred_endpoint, refresh_token_hook
        )
    except ThinkingSignatureInvalid:
        # Retry: strip reasoningContent from history
        retry_payload = _strip_reasoning_content(payload)
        return await _accumulate_stream(
            account, retry_payload, client, preferred_endpoint, refresh_token_hook
        )


async def _accumulate_stream(
    account: AccountLike,
    payload: dict[str, object],
    client: httpx.AsyncClient,
    preferred_endpoint: str | None,
    refresh_token_hook: callable[[AccountLike], object] | None,
) -> KiroStreamResult:
    """Accumulate streaming events into a KiroStreamResult."""
    result = KiroStreamResult()

    async for event in call_kiro_api_stream(
        account,
        payload,
        client=client,
        preferred_endpoint=preferred_endpoint,
        refresh_token_hook=refresh_token_hook,
    ):
        # assistantResponseEvent — text content
        if ar := event.get("assistantResponse"):
            result.content += ar.get("content", "")

        # codeEvent — CLI code content
        if ce := event.get("code"):
            result.content += ce.get("content", "")

        # toolUseEvent — tool call
        if tu := event.get("toolUse"):
            result.tool_uses.append(tu)

        # reasoningContentEvent — thinking
        if rc := event.get("reasoning"):
            if rc.get("text"):
                result.reasoning_text += rc["text"]
            if rc.get("signature"):
                result.reasoning_signature = rc["signature"]
            if rc.get("redactedContent"):
                result.redacted_content += rc["redactedContent"]

        # messageMetadataEvent — token usage
        if md := event.get("metadata"):
            if "tokenUsage" in md and md["tokenUsage"]:
                tu_data = md["tokenUsage"]
                uncached = int(tu_data.get("uncachedInputTokens", 0))
                cache_read = int(tu_data.get("cacheReadInputTokens", 0))
                cache_write = int(tu_data.get("cacheWriteInputTokens", 0))
                result.usage["inputTokens"] = uncached + cache_read + cache_write
                result.usage["outputTokens"] = int(tu_data.get("outputTokens", 0))
                result.usage["cacheReadTokens"] = cache_read
                result.usage["cacheWriteTokens"] = cache_write
            if md.get("inputTokens"):
                result.usage["inputTokens"] = int(md["inputTokens"])
            if md.get("outputTokens"):
                result.usage["outputTokens"] = int(md["outputTokens"])

        # meteringEvent — credit usage
        if me := event.get("metering"):
            result.usage["credits"] = result.usage.get("credits", 0.0) + me.get("usage", 0.0)

        # contextUsageEvent
        if cu := event.get("contextUsage"):
            result.usage["contextUsage"] = cu

    return result


# ── Helpers ────────────────────────────────────────────────────────────────────


def _prepare_payload(
    payload: dict[str, object], account: AccountLike, endpoint: _Endpoint
) -> dict[str, object]:
    """Clone payload and apply endpoint-specific adjustments."""
    import copy
    p = copy.deepcopy(payload)
    if account.profileArn:
        p["profileArn"] = account.profileArn
    return p


def _strip_reasoning_content(payload: dict[str, object]) -> dict[str, object]:
    """Deep-copy payload and strip reasoningContent from all history messages."""
    import copy
    p = copy.deepcopy(payload)
    cs = p.get("conversationState")
    if isinstance(cs, dict):
        history = cs.get("history")
        if isinstance(history, list):
            for msg in history:
                if isinstance(msg, dict):
                    arm = msg.get("assistantResponseMessage")
                    if isinstance(arm, dict) and "reasoningContent" in arm:
                        del arm["reasoningContent"]
    return p
