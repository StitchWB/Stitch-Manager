from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import logging
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from stitch_backend.database import get_db
from stitch_backend.domains.ai_proxy.account_selection import select_available_account
from stitch_backend.domains.ai_proxy.qoder_chat_gateway import (
    QoderAdapter,
    QoderCredentials,
    QoderProviderError,
)
from stitch_backend.domains.ai_proxy.service import (
    get_web_deepseek_settings,
    get_web_gemini_settings,
    get_web_qwen_settings,
    get_zai_token_db_path,
)
from stitch_backend.domains.ai_proxy.web.deepseek_adapter import (
    DeepSeekWebAdapter,
    load_web_deepseek_accounts,
)
from stitch_backend.domains.ai_proxy.web.gemini_adapter import (
    GeminiWebAdapter,
    load_web_gemini_accounts,
)
from stitch_backend.domains.ai_proxy.web.qwen_adapter import (
    QwenWebAdapter,
    load_web_qwen_accounts,
)
from stitch_backend.domains.ai_proxy.zai_chat_gateway import (
    ChatCompletionRequest,
    InvalidChatCompletionRequestError,
    ZaiChatCompletionFailedError,
    ZaiChatCompletionGateway,
    build_zai_chat_gateway,
)
from stitch_backend.domains.api_keys.service import ApiKeysService

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

chat_router = APIRouter(tags=["Chat"])

# Per-install local chat token. Generated once, persisted in the settings table
# under ``localChatToken`` (masked in get_settings), cached in-process. This
# replaces the shared static bearer so a token leaked from one install is not
# valid on another.
_LOCAL_CHAT_TOKEN: str | None = None
_TOKEN_SETTINGS_KEY = "localChatToken"


async def ensure_local_chat_token() -> str:
    """Load-or-create the per-install local chat token and cache it.

    Reads the raw settings row directly (not ``get_all``, which masks password
    keys). Creates and persists a random 32-byte hex token on first use.
    """
    global _LOCAL_CHAT_TOKEN
    if _LOCAL_CHAT_TOKEN:
        return _LOCAL_CHAT_TOKEN

    import secrets

    from sqlalchemy import select

    from stitch_backend.database import run_in_session
    from stitch_backend.domains.settings.models import Setting

    async def _load(session):
        result = await session.execute(
            select(Setting).where(Setting.key == _TOKEN_SETTINGS_KEY)
        )
        row = result.scalars().first()
        return row.value if row is not None else None

    token = await run_in_session(_load)
    if not token:
        token = secrets.token_hex(32)

        async def _save(session):
            from stitch_backend.domains.settings.service import SettingsService

            await SettingsService(session).update({_TOKEN_SETTINGS_KEY: token})

        await run_in_session(_save)
        logger.info("Generated a new per-install local chat token")
    _LOCAL_CHAT_TOKEN = token
    return _LOCAL_CHAT_TOKEN
_ALLOWED_CHAT_ORIGINS = {
    "http://localhost:25584",
    "http://127.0.0.1:25584",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
}

# ── Proxy security (ported from Kiro account-manager ProxyConfig) ──
# IP allow/deny lists (CIDR or single IP). Deny wins. Empty allow = allow all.
_ALLOWED_IPS: set[str] = set()
_DENIED_IPS: set[str] = set()
# Rate limit: max requests per window per key+IP bucket.
_RATE_LIMIT_PER_KEY_PER_MINUTE: int = 0  # 0 = disabled
_RATE_WINDOW_SECONDS: int = 60


@dataclass
class _RateBucket:
    timestamps: deque[float]


_rate_buckets: dict[str, _RateBucket] = {}


def _parse_ip_entries(raw: set[str]) -> list[ipaddress._BaseNetwork]:
    nets: list[ipaddress._BaseNetwork] = []
    for entry in raw:
        try:
            if "/" in entry:
                nets.append(ipaddress.ip_network(entry, strict=False))
            else:
                nets.append(ipaddress.ip_network(entry))
        except ValueError:
            continue
    return nets


def configure_proxy_security(
    *,
    allowed_ips: set[str] | None = None,
    denied_ips: set[str] | None = None,
    rate_limit_per_key_per_minute: int = 0,
) -> None:
    """Update proxy security config at runtime (called from settings)."""
    if allowed_ips is not None:
        _ALLOWED_IPS.clear()
        _ALLOWED_IPS.update(allowed_ips)
    if denied_ips is not None:
        _DENIED_IPS.clear()
        _DENIED_IPS.update(denied_ips)
    global _RATE_LIMIT_PER_KEY_PER_MINUTE
    _RATE_LIMIT_PER_KEY_PER_MINUTE = max(0, rate_limit_per_key_per_minute)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"


def _ip_allowed(ip_str: str) -> bool:
    if not _ALLOWED_IPS and not _DENIED_IPS:
        return True
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    denied = _parse_ip_entries(_DENIED_IPS)
    if any(ip in net for net in denied):
        return False
    allowed = _parse_ip_entries(_ALLOWED_IPS)
    if not allowed:
        return True
    return any(ip in net for net in allowed)


def _rate_limit_ok(bucket_key: str) -> bool:
    if _RATE_LIMIT_PER_KEY_PER_MINUTE <= 0:
        return True
    now = time.monotonic()
    bucket = _rate_buckets.get(bucket_key)
    if bucket is None:
        bucket = _RateBucket(timestamps=deque())
        _rate_buckets[bucket_key] = bucket
    cutoff = now - _RATE_WINDOW_SECONDS
    while bucket.timestamps and bucket.timestamps[0] < cutoff:
        bucket.timestamps.popleft()
    if len(bucket.timestamps) >= _RATE_LIMIT_PER_KEY_PER_MINUTE:
        return False
    bucket.timestamps.append(now)
    return True


def _timing_safe_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@chat_router.post("/v1/chat/completions")
async def create_chat_completion(
    request: Request,
    session: Annotated[AsyncSession, Depends(_get_session)],
) -> StreamingResponse:
    _require_local_chat_auth(request)
    _require_allowed_origin(request)
    _require_ip_allowed(request)
    _require_rate_limit(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail={"error": {"message": "Request body must be a JSON object"}})

    chat_request = _parse_chat_request(payload)
    handler = _CHAT_COMPLETION_HANDLERS.get(chat_request.provider)
    if handler is None:
        raise HTTPException(
            status_code=404,
            detail={"error": {"message": "Use the native gateway for this provider's chat completions"}},
        )
    return await handler(session, chat_request)


async def _handle_qoder_chat(
    session: AsyncSession, chat_request: ChatCompletionRequest
) -> StreamingResponse:
    adapter = await _build_qoder_adapter(session)
    try:
        response = await adapter.create_chat_completion(chat_request)
    except QoderProviderError as exc:
        raise HTTPException(
            status_code=502,
            detail={"error": {"code": exc.code, "message": "Qoder chat completion failed"}},
        ) from None
    finally:
        await adapter.close()
    return StreamingResponse(
        _to_sse(response),
        media_type="text/event-stream",
        headers={
            "X-Routed-Provider": "qoder",
            "X-Routed-Model": chat_request.model,
            "X-Requested-Model": chat_request.model,
        },
    )


async def _handle_zai_chat(
    session: AsyncSession, chat_request: ChatCompletionRequest
) -> StreamingResponse:
    gateway = await _build_gateway(session)
    try:
        response = await gateway.create_chat_completion(chat_request)
    except ZaiChatCompletionFailedError as exc:
        raise HTTPException(
            status_code=502,
            detail={"error": {"code": exc.code, "message": "Z.AI chat completion failed"}},
        ) from None
    return StreamingResponse(
        _to_sse(response),
        media_type="text/event-stream",
        headers={
            "X-Routed-Provider": "zai",
            "X-Routed-Model": chat_request.model,
            "X-Requested-Model": chat_request.model,
        },
    )


async def _handle_web_gemini_chat(
    session: AsyncSession, chat_request: ChatCompletionRequest
) -> StreamingResponse:
    # D5: ALL DB reads happen in the builder BEFORE the response streams.
    adapter = await _build_web_gemini_adapter(session)
    # Release the write-DB connection before streaming: the engine pool is
    # pool_size=1, and a yield-dependency session stays checked out until the
    # StreamingResponse is exhausted. Holding it would stall every other app
    # write — and the adapter's own cooldown marking — for the whole stream.
    await session.close()
    request_payload: dict[str, object] = {
        "model": chat_request.model,
        "messages": chat_request.raw_messages or [],
        "tools": chat_request.tools,
    }
    return StreamingResponse(
        _stream_web_gemini(adapter, request_payload),
        media_type="text/event-stream",
        headers={
            "X-Routed-Provider": "web-gemini",
            "X-Routed-Model": chat_request.model,
            "X-Requested-Model": chat_request.model,
        },
    )


async def _build_web_gemini_adapter(session: AsyncSession) -> GeminiWebAdapter:
    """Load settings + ORM accounts (D1) before any streaming begins (D5)."""
    settings = await get_web_gemini_settings(session)
    if not settings["enabled"]:
        raise HTTPException(
            status_code=404,
            detail={"error": {"message": "web-gemini provider is disabled"}},
        )
    accounts = await load_web_gemini_accounts(session)
    return GeminiWebAdapter(
        accounts=accounts, settings=settings, proxy=await _resolve_outbound_proxy()
    )


async def _resolve_outbound_proxy() -> str | None:
    """Global outbound proxy per D6 (never direct when proxy is configured)."""
    from stitch_backend.core.http_gateway import ProxyUnavailableError, gateway

    try:
        return await gateway().get_outbound_proxy_url()
    except ProxyUnavailableError:
        raise HTTPException(
            status_code=503,
            detail={"error": {"message": "Outbound proxy is unavailable"}},
        ) from None


async def _handle_web_deepseek_chat(
    session: AsyncSession, chat_request: ChatCompletionRequest
) -> StreamingResponse:
    # D5: ALL DB reads happen in the builder BEFORE the response streams.
    adapter = await _build_web_deepseek_adapter(session)
    # Release the write-DB connection before streaming (pool_size=1) — same
    # discipline as web-gemini.
    await session.close()
    request_payload: dict[str, object] = {
        "model": chat_request.model,
        "messages": chat_request.raw_messages or [],
        "tools": chat_request.tools,
    }
    return StreamingResponse(
        _stream_web_deepseek(adapter, request_payload),
        media_type="text/event-stream",
        headers={
            "X-Routed-Provider": "web-deepseek",
            "X-Routed-Model": chat_request.model,
            "X-Requested-Model": chat_request.model,
        },
    )


async def _build_web_deepseek_adapter(session: AsyncSession) -> DeepSeekWebAdapter:
    """Load settings + ORM accounts (D1) before any streaming begins (D5)."""
    settings = await get_web_deepseek_settings(session)
    if not settings["enabled"]:
        raise HTTPException(
            status_code=404,
            detail={"error": {"message": "web-deepseek provider is disabled"}},
        )
    accounts = await load_web_deepseek_accounts(session)
    return DeepSeekWebAdapter(
        accounts=accounts, settings=settings, proxy=await _resolve_outbound_proxy()
    )


async def _stream_web_deepseek(
    adapter: DeepSeekWebAdapter, request: dict[str, object]
) -> AsyncGenerator[str, None]:
    """Pass through the adapter's OpenAI SSE chunks (true streaming)."""
    async for chunk in adapter.stream_chat_completion(request):
        yield chunk


async def _handle_web_qwen_chat(
    session: AsyncSession, chat_request: ChatCompletionRequest
) -> StreamingResponse:
    # D5: ALL DB reads happen in the builder BEFORE the response streams.
    adapter = await _build_web_qwen_adapter(session)
    # Release the write-DB connection before streaming (pool_size=1).
    await session.close()
    request_payload: dict[str, object] = {
        "model": chat_request.model,
        "messages": chat_request.raw_messages or [],
        "tools": chat_request.tools,
    }
    return StreamingResponse(
        _stream_web_qwen(adapter, request_payload),
        media_type="text/event-stream",
        headers={
            "X-Routed-Provider": "web-qwen",
            "X-Routed-Model": chat_request.model,
            "X-Requested-Model": chat_request.model,
        },
    )


async def _build_web_qwen_adapter(session: AsyncSession) -> QwenWebAdapter:
    """Load settings + ORM accounts (D1) before any streaming begins (D5)."""
    settings = await get_web_qwen_settings(session)
    if not settings["enabled"]:
        raise HTTPException(
            status_code=404,
            detail={"error": {"message": "web-qwen provider is disabled"}},
        )
    accounts = await load_web_qwen_accounts(session)
    return QwenWebAdapter(
        accounts=accounts, settings=settings, proxy=await _resolve_outbound_proxy()
    )


async def _stream_web_qwen(
    adapter: QwenWebAdapter, request: dict[str, object]
) -> AsyncGenerator[str, None]:
    """Pass through the adapter's OpenAI SSE chunks (true streaming)."""
    async for chunk in adapter.stream_chat_completion(request):
        yield chunk


async def _stream_web_gemini(
    adapter: GeminiWebAdapter, request: dict[str, object]
) -> AsyncGenerator[str, None]:
    """Pass through the adapter's OpenAI SSE chunks (true streaming)."""
    async for chunk in adapter.stream_chat_completion(request):
        yield chunk


# Dispatch for the local /v1/chat/completions endpoint. Adding a provider =
# adding an entry. Native-gateway providers (openai/anthropic/kiro/...) are
# served by litellm_gateway / kiro_gateway, NOT this endpoint — they hit a
# different mount and never reach this handler.
_CHAT_COMPLETION_HANDLERS = {
    "qoder": _handle_qoder_chat,
    "zai": _handle_zai_chat,
    "web-gemini": _handle_web_gemini_chat,
    "web-deepseek": _handle_web_deepseek_chat,
    "web-qwen": _handle_web_qwen_chat,
}


async def _get_session() -> AsyncGenerator[AsyncSession, None]:
    async with get_db() as session:
        yield session


def _parse_chat_request(payload: dict) -> ChatCompletionRequest:
    try:
        return ChatCompletionRequest.from_openai_payload(payload)
    except InvalidChatCompletionRequestError as exc:
        raise HTTPException(status_code=422, detail={"error": {"message": str(exc)}}) from None


def _require_local_chat_auth(request: Request) -> None:
    from stitch_backend.domains.ai_proxy.local_auth import require_local_chat_auth

    require_local_chat_auth(request.headers.get("authorization"))


def _require_allowed_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin is not None and origin not in _ALLOWED_CHAT_ORIGINS:
        raise HTTPException(status_code=403, detail={"error": {"message": "Forbidden origin"}})


def _require_ip_allowed(request: Request) -> None:
    if not _ip_allowed(_client_ip(request)):
        raise HTTPException(status_code=403, detail={"error": {"message": "Forbidden IP"}})


def _require_rate_limit(request: Request) -> None:
    if not _rate_limit_ok(_hash_token(request.headers.get("authorization") or "") + ":" + _client_ip(request)):
        raise HTTPException(
            status_code=429,
            detail={"error": {"message": "Rate limit exceeded"}},
        )


async def _build_gateway(session: AsyncSession) -> ZaiChatCompletionGateway:
    keys = await ApiKeysService(session).get_keys("zai")
    key = _first_configured_key(keys)
    token_db_path = await get_zai_token_db_path(session)
    if key is None:
        raise HTTPException(status_code=400, detail={"error": {"message": "Z.AI credentials are not configured"}})
    if not token_db_path:
        raise HTTPException(status_code=400, detail={"error": {"message": "zai_token_db_path is not configured"}})

    api_key = key.get("apiKey")
    user_id = key.get("prefix")
    if not isinstance(api_key, str) or not api_key.strip():
        raise HTTPException(status_code=400, detail={"error": {"message": "Z.AI credentials are not configured"}})
    if not isinstance(user_id, str) or not user_id.strip():
        raise HTTPException(status_code=400, detail={"error": {"message": "Z.AI user id is not configured"}})

    return build_zai_chat_gateway(
        auth_token=api_key,
        token_db_path=Path(token_db_path),
        user_id=user_id,
    )


async def _build_qoder_adapter(session: AsyncSession) -> QoderAdapter:
    from stitch_backend.domains.ai_proxy.service import AiProxyAccountStore

    accounts = await AiProxyAccountStore.get_accounts(session)
    qoder_accounts = [account for account in accounts if str(account.get("provider", "")).lower() == "qoder"]
    account = select_available_account(qoder_accounts, provider="qoder")
    if account is not None:
        from httpx import AsyncClient

        return QoderAdapter(
            client=AsyncClient(timeout=30.0),
            credentials=QoderCredentials(
                api_key=_string_value(account.get("apiKey")),
                access_token=_string_value(account.get("oauthToken")),
                refresh_token=_string_value(account.get("oauthRefreshToken")),
            ),
        )

    if qoder_accounts:
        raise HTTPException(status_code=429, detail={"error": {"message": "Qoder accounts are cooling down"}})

    keys = await ApiKeysService(session).get_keys("qoder")
    key = _first_configured_key(keys)
    if key is None:
        raise HTTPException(status_code=400, detail={"error": {"message": "Qoder credentials are not configured"}})
    from httpx import AsyncClient

    return QoderAdapter(
        client=AsyncClient(timeout=30.0),
        credentials=QoderCredentials(
            api_key=key.get("apiKey"),
        ),
    )


def _string_value(value: str | int | float | bool | None) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _first_configured_key(keys: list[dict]) -> dict | None:
    for key in keys:
        api_key = key.get("apiKey")
        if isinstance(api_key, str) and api_key.strip():
            return key
    return None


async def _to_sse(response: dict) -> AsyncGenerator[str, None]:
    content = _extract_content(response)
    chunk = {"choices": [{"delta": {"content": content}}]}
    yield f"data: {json.dumps(chunk)}\n\n"
    yield "data: [DONE]\n\n"


def _extract_content(response: dict) -> str:
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    return content if isinstance(content, str) else ""
