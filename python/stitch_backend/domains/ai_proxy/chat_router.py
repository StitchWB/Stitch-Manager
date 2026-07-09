from __future__ import annotations

import json
from collections.abc import AsyncGenerator
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


@chat_router.post("/v1/chat/completions")
async def create_chat_completion(
    request: Request,
    session: Annotated[AsyncSession, Depends(_get_session)],
) -> StreamingResponse:
    _require_local_chat_auth(request)
    _require_allowed_origin(request)
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
    if request.headers.get("authorization") != _LOCAL_CHAT_BEARER:
        raise HTTPException(status_code=401, detail={"error": {"message": "Unauthorized"}})


def _require_allowed_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin is not None and origin not in _ALLOWED_CHAT_ORIGINS:
        raise HTTPException(status_code=403, detail={"error": {"message": "Forbidden origin"}})


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
