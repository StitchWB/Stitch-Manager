from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import time
from collections import deque
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.database import get_db
from stitch_backend.domains.ai_proxy.service import get_zai_token_db_path
from stitch_backend.domains.ai_proxy.zai_chat_gateway import (
    ChatCompletionRequest,
    InvalidChatCompletionRequestError,
    ZaiChatCompletionFailedError,
    ZaiChatCompletionGateway,
    build_zai_chat_gateway,
)
from stitch_backend.domains.api_keys.service import ApiKeysService


chat_router = APIRouter(tags=["Chat"])
_LOCAL_CHAT_BEARER = "Bearer proxypal-local"
_ALLOWED_CHAT_ORIGINS = {
    "http://localhost:25584",
    "http://127.0.0.1:25584",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "tauri://localhost",
    "https://tauri.localhost",
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
    if chat_request.provider != "zai":
        raise HTTPException(
            status_code=404,
            detail={"error": {"message": "Use OmniRoute for non-Z.AI chat completions"}},
        )

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


async def _get_session() -> AsyncGenerator[AsyncSession, None]:
    async with get_db() as session:
        yield session


def _parse_chat_request(payload: dict) -> ChatCompletionRequest:
    try:
        return ChatCompletionRequest.from_openai_payload(payload)
    except InvalidChatCompletionRequestError as exc:
        raise HTTPException(status_code=422, detail={"error": {"message": str(exc)}}) from None


def _require_local_chat_auth(request: Request) -> None:
    if not _timing_safe_equal(request.headers.get("authorization") or "", _LOCAL_CHAT_BEARER):
        raise HTTPException(status_code=401, detail={"error": {"message": "Unauthorized"}})


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
