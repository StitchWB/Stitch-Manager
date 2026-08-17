"""Qwen web adapter — concrete ``WebSessionAdapter`` (Phase 2a).

Ports the Qwen ``chat.qwen.ai`` v2 protocol from the Go reference
(``_references/qwen2API``, study material only):

- ``POST /api/v2/chats/new``            -> chat_id
- ``POST /api/v2/chat/completions?chat_id=`` (stream, incremental)
- ``DELETE /api/v2/chats/<id>``         -> best-effort cleanup

Auth is a Bearer token (the web app's localStorage token, stored in the ORM
``accounts.token`` column for ``provider="web-qwen"``). SSE deltas carry
``choices[0].delta`` with ``content`` / ``phase`` plus reasoning fields which
are shaped into OpenAI ``reasoning_content`` deltas.
"""

from __future__ import annotations

import json
import logging
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import select, update

from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError
from stitch_backend.domains.ai_proxy.account_selection import select_available_account
from stitch_backend.domains.ai_proxy.web.base import (
    ModelDict,
    sanitize_secrets,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

QWEN_BASE_URL = "https://chat.qwen.ai"

# Fallback cooldown when the upstream gives no explicit deadline.
_COOLDOWN_SECONDS = 300

# Public web models advertised by the adapter (thinking handled per-model).
MODELS: dict[str, dict[str, Any]] = {
    "qwen3-max": {"thinking": True, "desc": "Qwen3 Max (thinking)"},
    "qwen3-coder-plus": {"thinking": False, "desc": "Qwen3 Coder Plus"},
    "qwen3-plus": {"thinking": True, "desc": "Qwen3 Plus (thinking)"},
    "qwen3-turbo": {"thinking": False, "desc": "Qwen3 Turbo"},
}


# ─── Protocol helpers (pure, testable) ───────────────────────────────────────


def qwen_request_id() -> str:
    return str(uuid.uuid4())


def qwen_headers(token: str) -> dict[str, str]:
    """Browser-like headers for chat.qwen.ai (mirrors the Go reference)."""
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": f"{QWEN_BASE_URL}/",
        "Origin": QWEN_BASE_URL,
        "Connection": "keep-alive",
        "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "x-request-id": qwen_request_id(),
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def build_chat_payload(
    chat_id: str,
    model: str,
    content: str,
    *,
    thinking_enabled: bool | None = None,
) -> dict[str, Any]:
    """Build the ``/api/v2/chat/completions`` request body (v2 protocol)."""
    ts = int(time.time())
    thinking = thinking_enabled if thinking_enabled is not None else True
    feature_config = {
        "thinking_enabled": thinking,
        "output_schema": "phase",
        "research_mode": "normal",
        "auto_thinking": thinking,
        "thinking_mode": "Auto" if thinking else "Disabled",
        "thinking_format": "summary",
        "auto_search": False,
        "code_interpreter": False,
        "plugins_enabled": False,
        "function_calling": False,
        "enable_tools": False,
        "enable_function_call": False,
        "tool_choice": "none",
    }
    return {
        "stream": True,
        "version": "2.1",
        "incremental_output": True,
        "chat_id": chat_id,
        "chat_mode": "normal",
        "model": model,
        "parent_id": None,
        "messages": [
            {
                "fid": secrets.token_hex(16),
                "parentId": None,
                "childrenIds": [secrets.token_hex(16)],
                "role": "user",
                "content": content,
                "user_action": "chat",
                "files": [],
                "timestamp": ts,
                "models": [model],
                "chat_type": "t2t",
                "feature_config": feature_config,
                "extra": {"meta": {"subChatType": "t2t"}},
                "sub_chat_type": "t2t",
                "parent_id": None,
            }
        ],
        "timestamp": ts,
    }


def parse_qwen_event(obj: dict[str, Any]) -> list[dict[str, str]]:
    """Normalize one SSE JSON object into delta dicts.

    Returns entries ``{"phase": ..., "content": ..., "reasoning": ...}``.
    Mirrors the Go reference ``ParseQwenEvent`` for the fields we shape.
    """

    def first_string(*values: Any) -> str:
        for value in values:
            if isinstance(value, str) and value.strip():
                return value
        return ""

    events: list[dict[str, str]] = []
    choices = obj.get("choices")
    if isinstance(choices, list) and choices:
        choice = choices[0]
        if isinstance(choice, dict):
            delta = choice.get("delta")
            if isinstance(delta, dict):
                phase = first_string(delta.get("phase")) or "answer"
                content = first_string(delta.get("content"))
                reasoning = first_string(
                    delta.get("reasoning_content"),
                    delta.get("reasoning"),
                    delta.get("reasoning_text"),
                    delta.get("thinking"),
                    delta.get("thoughts"),
                )
                if reasoning:
                    content = reasoning
                    if phase == "answer":
                        phase = "thinking_summary"
                if content or reasoning:
                    events.append(
                        {"phase": phase, "content": content, "reasoning": reasoning}
                    )
                return events
    content = first_string(
        obj.get("content"), obj.get("answer"), obj.get("text"), obj.get("delta")
    )
    reasoning = first_string(
        obj.get("reasoning_content"), obj.get("reasoning"), obj.get("thinking")
    )
    if content or reasoning:
        phase = "answer"
        if reasoning:
            content = reasoning
            phase = "thinking_summary"
        events.append({"phase": phase, "content": content, "reasoning": reasoning})
    return events


def extract_upstream_error(obj: dict[str, Any]) -> str:
    """Best-effort human-readable upstream error (mirrors FormatUpstreamError)."""
    if not isinstance(obj, dict):
        return ""
    if obj.get("success") is False:
        data = obj.get("data")
        code = ""
        details = ""
        if isinstance(data, dict):
            code = str(data.get("code") or obj.get("code") or "upstream_error")
            details = str(data.get("details") or data.get("message") or "")
        return f"Qwen upstream error code={code} details={details}"
    error = obj.get("error")
    if isinstance(error, dict):
        code = str(error.get("code") or "upstream_error")
        details = str(error.get("details") or error.get("message") or "")
        return f"Qwen upstream error code={code} details={details}"
    if isinstance(error, str) and error.strip():
        return f"Qwen upstream error details={error}"
    return ""


# ─── Account loading (D1) ────────────────────────────────────────────────────


async def load_web_qwen_accounts(session: AsyncSession) -> list[dict[str, Any]]:
    """Load web-qwen accounts from the ORM ``accounts`` table."""
    from stitch_backend.domains.accounts.models import Account

    stmt = (
        select(Account)
        .where(Account.provider == "web-qwen")
        .where(Account.status != "archived")
        .order_by(Account.created_at.desc())
    )
    result = await session.execute(stmt)
    rows = result.scalars().all()

    mapped: list[dict[str, Any]] = []
    for acc in rows:
        cooldown_ts = 0
        if acc.cooldown_until is not None:
            try:
                cooldown_ts = int(acc.cooldown_until.timestamp())
            except (ValueError, OSError):
                cooldown_ts = 0
        mapped.append(
            {
                "id": str(acc.id),
                "provider": acc.provider,
                "token": str(acc.token or ""),
                "enabled": acc.status
                not in ("archived", "disabled", "banned", "expired"),
                "cooldownUntil": cooldown_ts,
            }
        )
    return mapped


# ─── HTTP client (injectable for tests) ──────────────────────────────────────


class HttpxQwenHttpClient:
    """Default async httpx client for the Qwen v2 protocol."""

    def __init__(self, proxy: str | None = None) -> None:
        self._proxy = proxy

    async def post_json(
        self, url: str, headers: dict[str, str], body: dict[str, Any] | None
    ) -> tuple[int, str]:
        import httpx

        async with httpx.AsyncClient(timeout=30, proxy=self._proxy) as client:
            resp = await client.post(url, headers=headers, json=body)
        return resp.status_code, resp.text

    async def delete(self, url: str, headers: dict[str, str]) -> int:
        import httpx

        async with httpx.AsyncClient(timeout=20, proxy=self._proxy) as client:
            resp = await client.delete(url, headers=headers)
        return resp.status_code

    async def stream_post(
        self, url: str, headers: dict[str, str], body: dict[str, Any]
    ) -> AsyncIterator[str]:
        import httpx

        stream_headers = {**headers, "Accept": "text/event-stream"}
        async with httpx.AsyncClient(timeout=180, proxy=self._proxy) as client:
            async with client.stream(
                "POST", url, headers=stream_headers, json=body
            ) as resp:
                if resp.status_code != 200:
                    body_text = (await resp.aread()).decode("utf-8", "replace")
                    raise QwenUpstreamError(resp.status_code, body_text)
                async for chunk in resp.aiter_text():
                    yield chunk


class QwenUpstreamError(RuntimeError):
    def __init__(self, status: int, body: str = "") -> None:
        super().__init__(f"Qwen upstream HTTP {status}: {body[:200]}")
        self.status = status
        self.body = body


# ─── Adapter ────────────────────────────────────────────────────────────────


class QwenWebAdapter:
    """In-process Qwen web adapter implementing ``WebSessionAdapter``."""

    provider_id = "web-qwen"

    def __init__(
        self,
        *,
        accounts: list[dict[str, Any]],
        settings: dict[str, bool],
        client_factory: Callable[[str | None], Any] | None = None,
        clock: Callable[[], float] | None = None,
        proxy: str | None = None,
    ) -> None:
        self._accounts = accounts
        self._settings = settings
        self._client_factory = client_factory or HttpxQwenHttpClient
        self._clock = clock or time.time
        self._proxy = proxy
        self._secrets: set[str] = set()

    # ── WebSessionAdapter surface ─────────────────────────────────────────

    async def available(self) -> bool:
        return any(a.get("enabled") and a.get("token") for a in self._accounts)

    async def list_models(self) -> list[ModelDict]:
        if not any(a.get("enabled") and a.get("token") for a in self._accounts):
            return []
        return [
            {
                "id": name,
                "provider": self.provider_id,
                "name": str(info["desc"]),
                "object": "model",
            }
            for name, info in MODELS.items()
        ]

    def classify_error(
        self,
        exc: BaseException,
        *,
        http_status: int | None = None,
    ) -> ClassifiedError:
        status = http_status
        if status is None and isinstance(exc, QwenUpstreamError):
            status = exc.status
        if status == 429:
            return ClassifiedError(category="rate_limited")
        if status in (401, 403):
            return ClassifiedError(category="auth_failed")
        if status is not None and 500 <= status < 600:
            return ClassifiedError(category="server_error")
        return ClassifiedError(category="transport_error")

    def stream_chat_completion(
        self, request: dict[str, object]
    ) -> AsyncIterator[str]:
        return self._stream(request)

    # ── Internals ──────────────────────────────────────────────────────────

    async def _stream(self, request: dict[str, object]) -> AsyncIterator[str]:
        model = str(request.get("model", ""))
        info = MODELS.get(model)
        if info is None:
            yield self._error_chunk("model_not_found", f"Unknown model: {model}")
            yield "data: [DONE]\n\n"
            return

        messages = request.get("messages")
        content = _messages_to_content(messages)

        tried: set[str] = set()
        while True:
            available = [
                a
                for a in self._accounts
                if str(a.get("id")) not in tried and a.get("token")
            ]
            account = select_available_account(
                available, provider=self.provider_id, now=int(self._clock())
            )
            if account is None:
                yield self._error_chunk("no_account", "No available web-qwen account")
                yield "data: [DONE]\n\n"
                return

            account_id = str(account.get("id"))
            token = str(account.get("token", "") or "")
            self._secrets.add(token)

            client = self._client_factory(self._proxy)
            chat_id: str | None = None
            try:
                chat_id = await self._create_chat(client, token, model)
                payload = build_chat_payload(
                    chat_id,
                    model,
                    content,
                    thinking_enabled=bool(info.get("thinking")),
                )
                url = f"{QWEN_BASE_URL}/api/v2/chat/completions?chat_id={chat_id}"
                headers = qwen_headers(token)
                yielded = False
                async for chunk_text in client.stream_post(url, headers, payload):
                    for event in _iter_sse_events(chunk_text):
                        if event["phase"] == "thinking_summary" or event["reasoning"]:
                            if event["content"]:
                                yield self._reasoning_chunk(event["content"])
                        elif event["content"]:
                            yield self._content_chunk(event["content"])
                            yielded = True
                if not yielded:
                    raise QwenUpstreamError(502, "empty upstream stream")
                yield "data: [DONE]\n\n"
                return
            except Exception as exc:  # noqa: BLE001
                classified = self.classify_error(exc)
                if classified.category in ("auth_failed", "rate_limited"):
                    tried.add(account_id)
                    await self._mark_cooldown(account_id, classified)
                    logger.info(
                        "web-qwen: %s on account %s, trying next",
                        classified.category,
                        account_id,
                    )
                    continue
                yield self._error_chunk(
                    classified.category, self._sanitize(str(exc))
                )
                yield "data: [DONE]\n\n"
                return
            finally:
                if chat_id:
                    try:
                        await client.delete(
                            f"{QWEN_BASE_URL}/api/v2/chats/{chat_id}",
                            qwen_headers(token),
                        )
                    except Exception:  # noqa: BLE001 — cleanup best-effort
                        logger.debug("web-qwen: chat cleanup failed", exc_info=True)

    async def _create_chat(self, client: Any, token: str, model: str) -> str:
        ts = int(time.time())
        body = {
            "title": f"api_{ts}",
            "models": [model],
            "chat_mode": "normal",
            "chat_type": "t2t",
            "timestamp": ts,
        }
        status, text = await client.post_json(
            f"{QWEN_BASE_URL}/api/v2/chats/new", qwen_headers(token), body
        )
        if status != 200:
            raise QwenUpstreamError(status, text)
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise QwenUpstreamError(502, f"create_chat parse error: {exc}") from exc
        data = payload.get("data")
        chat_id = data.get("id") if isinstance(data, dict) else None
        if payload.get("success") is False or not isinstance(chat_id, str):
            raise QwenUpstreamError(502, f"create_chat failed: {text[:200]}")
        return chat_id

    # ── SSE chunk builders ────────────────────────────────────────────────

    @staticmethod
    def _content_chunk(content: str) -> str:
        return f"data: {json.dumps({'choices': [{'delta': {'content': content}}]})}\n\n"

    @staticmethod
    def _reasoning_chunk(content: str) -> str:
        return (
            f"data: {json.dumps({'choices': [{'delta': {'reasoning_content': content}}]})}\n\n"
        )

    def _error_chunk(self, code: str, message: str) -> str:
        chunk = {"error": {"code": code, "message": self._sanitize(message)}}
        return f"data: {json.dumps(chunk)}\n\n"

    def _sanitize(self, text: str) -> str:
        return sanitize_secrets(text, self._secrets)

    async def _mark_cooldown(
        self, account_id: str, classified: ClassifiedError
    ) -> None:
        from stitch_backend.domains.accounts.models import Account

        seconds = (
            classified.retry_after_seconds
            if classified.retry_after_seconds
            else _COOLDOWN_SECONDS
        )
        cooldown_until = datetime.now(UTC) + timedelta(seconds=seconds)

        async def _op(session: AsyncSession) -> None:
            await session.execute(
                update(Account)
                .where(Account.id == str(account_id))
                .values(cooldown_until=cooldown_until, updated_at=datetime.now(UTC))
            )

        try:
            await run_in_session(_op)
        except Exception as exc:  # noqa: BLE001 — non-fatal
            logger.warning(
                "web-qwen: failed to mark cooldown for %s: %s", account_id, exc
            )


# ─── Prompt shaping + SSE iteration ──────────────────────────────────────────


def _messages_to_content(messages: object) -> str:
    """Qwen v2 takes a single user content string; flatten the transcript."""
    if not isinstance(messages, list):
        return ""
    parts: list[str] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role", "user"))
        content = message.get("content")
        if content is None:
            content = ""
        if not isinstance(content, str):
            content = str(content)
        if role == "system":
            parts.append(f"[System]: {content}")
        elif role == "assistant":
            parts.append(f"[Assistant]: {content}")
        elif role == "tool":
            parts.append(f"[Tool result]: {content}")
        else:
            parts.append(content)
    return "\n\n".join(p for p in parts if p)


def _iter_sse_events(buffer: str) -> list[dict[str, str]]:
    """Parse ``data:`` JSON lines from an SSE chunk buffer."""
    events: list[dict[str, str]] = []
    for raw_line in buffer.split("\n"):
        line = raw_line.strip()
        if not line.startswith("data:"):
            continue
        data = line.removeprefix("data:").strip()
        if not data or data == "[DONE]":
            continue
        try:
            obj = json.loads(data)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            events.extend(parse_qwen_event(obj))
    return events
