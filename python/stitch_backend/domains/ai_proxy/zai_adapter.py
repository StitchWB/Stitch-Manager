from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sqlite3
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, TypeAlias


ZAI_BASE_URL = "https://chat.z.ai"
ZAI_CHAT_COMPLETIONS_URL = f"{ZAI_BASE_URL}/api/v2/chat/completions"
ZAI_SIGNATURE_SALT = "key-@@@@)))()((9))-xxxx&&&%%%%%"
DEFAULT_FE_VERSION = "prod-fe-1.0.185"

JsonScalar: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonScalar | dict[str, "JsonValue"] | list["JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]


@dataclass(frozen=True, slots=True)
class ZaiMessage:
    role: str
    content: str


@dataclass(frozen=True, slots=True)
class ZaiAdapterConfig:
    auth_token: str
    token_db_path: Path
    user_id: str
    fe_version: str = DEFAULT_FE_VERSION
    base_url: str = ZAI_BASE_URL


@dataclass(frozen=True, slots=True)
class ZaiHttpRequest:
    url: str
    headers: dict[str, str]
    json_body: JsonObject


@dataclass(frozen=True, slots=True)
class ZaiHttpResponse:
    status_code: int
    text: str


@dataclass(frozen=True, slots=True)
class ZaiChatResult:
    content: str


class ZaiHttpClient(Protocol):
    async def send(self, request: ZaiHttpRequest, proxy: str | None = None) -> ZaiHttpResponse: ...


class ZaiAdapterError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


class HttpxZaiHttpClient:
    async def send(self, request: ZaiHttpRequest, proxy: str | None = None) -> ZaiHttpResponse:
        import httpx

        async with httpx.AsyncClient(timeout=60.0, proxy=proxy) as client:
            response = await client.post(request.url, headers=request.headers, json=request.json_body)
        return ZaiHttpResponse(status_code=response.status_code, text=response.text)


class ZaiAdapter:
    def __init__(
        self,
        config: ZaiAdapterConfig,
        http_client: ZaiHttpClient | None = None,
        clock: Callable[[], float] | None = None,
        request_id_factory: Callable[[], str] | None = None,
        refresh_token: Callable[[], Awaitable[str]] | None = None,
    ) -> None:
        self._config = config
        self._http_client = http_client or HttpxZaiHttpClient()
        self._clock = clock or time.time
        self._request_id_factory = request_id_factory or (lambda: uuid.uuid4().hex)
        self._refresh_token = refresh_token
        self._auth_token = config.auth_token
        self._sensitive_values = {config.auth_token}

    async def create_chat_completion(self, model: str, messages: list[ZaiMessage]) -> ZaiChatResult:
        response = await self._send_once(model=model, messages=messages)
        if response.status_code == 401 and self._refresh_token is not None:
            self._auth_token = await self._refresh_token()
            self._sensitive_values.add(self._auth_token)
            response = await self._send_once(model=model, messages=messages)
        return self._parse_response(response)

    async def _send_once(self, model: str, messages: list[ZaiMessage]) -> ZaiHttpResponse:
        captcha_token = self._consume_captcha_token()
        request_id = self._request_id_factory()
        timestamp = int(self._clock())
        body: JsonObject = {
            "model": model,
            "messages": [{"role": message.role, "content": message.content} for message in messages],
            "stream": True,
            "captcha_verify_param": captcha_token,
        }
        headers = {
            "authorization": f"Bearer {self._auth_token}",
            "content-type": "application/json",
            "x-fe-version": self._config.fe_version,
            "x-request-id": request_id,
            "x-signature": self._signature(
                request_id=request_id,
                timestamp=timestamp,
                user_id=self._config.user_id,
                prompt=_signature_prompt(messages),
            ),
        }
        return await self._http_client.send(
            ZaiHttpRequest(
                url=f"{self._config.base_url}/api/v2/chat/completions",
                headers=headers,
                json_body=body,
            )
        )

    def _consume_captcha_token(self) -> str:
        db_path = self._config.token_db_path
        if not db_path.exists():
            raise ZaiAdapterError("token_db_missing", "Z.AI captcha token database does not exist")

        try:
            with sqlite3.connect(db_path) as connection:
                row = connection.execute("SELECT id, token FROM tokens ORDER BY id LIMIT 1").fetchone()
                if row is None:
                    raise ZaiAdapterError("captcha_token_unavailable", "Z.AI captcha token database is empty")
                token_id = int(row[0])
                token = str(row[1])
                connection.execute("DELETE FROM tokens WHERE id = ?", (token_id,))
                connection.commit()
        except sqlite3.Error as exc:
            raise ZaiAdapterError("captcha_token_unavailable", "Z.AI captcha token database is unavailable") from exc
        self._sensitive_values.add(token)
        return token

    def _signature(self, request_id: str, timestamp: int, user_id: str, prompt: str) -> str:
        prompt_b64 = base64.b64encode(prompt.encode("utf-8")).decode("ascii")
        bucket = timestamp // 300
        payload = f"{bucket}:{request_id}:{timestamp}:{user_id}:{prompt_b64}"
        key = hashlib.sha256(ZAI_SIGNATURE_SALT.encode("utf-8")).digest()
        return hmac.new(key, payload.encode("utf-8"), hashlib.sha256).hexdigest()

    def _parse_response(self, response: ZaiHttpResponse) -> ZaiChatResult:
        if response.status_code == 200:
            return ZaiChatResult(content=_parse_sse_content(response.text))
        if _looks_like_html(response.text):
            raise ZaiAdapterError("upstream_html", "Z.AI upstream returned an HTML/WAF response")
        message = self._extract_error_message(response.text)
        raise ZaiAdapterError("upstream_error", self._sanitize(message))

    def _extract_error_message(self, text: str) -> str:
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return "Z.AI upstream returned an error"
        if not isinstance(payload, dict):
            return "Z.AI upstream returned an error"
        error = payload.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str) and message:
                return message
        message = payload.get("message")
        if isinstance(message, str) and message:
            return message
        return "Z.AI upstream returned an error"

    def _sanitize(self, message: str) -> str:
        sanitized = message
        for value in self._sensitive_values:
            if value:
                sanitized = sanitized.replace(value, "[redacted]")
        return sanitized


def _signature_prompt(messages: list[ZaiMessage]) -> str:
    return "\n".join(message.content for message in messages)


def _looks_like_html(text: str) -> bool:
    return text.lstrip().lower().startswith("<")


def _parse_sse_content(text: str) -> str:
    chunks: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line.startswith("data:"):
            continue
        data = line.removeprefix("data:").strip()
        if data == "[DONE]":
            break
        chunks.append(_content_from_sse_json(data))
    return "".join(chunks)


def _content_from_sse_json(data: str) -> str:
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        return ""
    if not isinstance(payload, dict):
        return ""
    data_payload = payload.get("data")
    if isinstance(data_payload, dict):
        delta_content = data_payload.get("delta_content")
        if isinstance(delta_content, str):
            return delta_content
        edit_content = data_payload.get("edit_content")
        if isinstance(edit_content, str):
            return edit_content
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first_choice = choices[0]
        if isinstance(first_choice, dict):
            delta = first_choice.get("delta")
            if isinstance(delta, dict):
                content = delta.get("content")
                if isinstance(content, str):
                    return content
    return ""
