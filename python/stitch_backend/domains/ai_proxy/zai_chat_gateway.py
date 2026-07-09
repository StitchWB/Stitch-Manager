from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, TypeAlias

from stitch_backend.domains.ai_proxy.zai_adapter import (
    DEFAULT_FE_VERSION,
    ZaiAdapter,
    ZaiAdapterConfig,
    ZaiAdapterError,
    ZaiChatResult,
    ZaiMessage,
)

JsonScalar: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonScalar | dict[str, "JsonValue"] | list["JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]


class ZaiChatAdapter(Protocol):
    async def create_chat_completion(self, model: str, messages: list[ZaiMessage]) -> ZaiChatResult: ...


@dataclass(frozen=True, slots=True)
class ChatCompletionRequest:
    provider: str
    model: str
    messages: list[ZaiMessage]

    @classmethod
    def from_openai_payload(cls, payload: JsonObject) -> ChatCompletionRequest:
        provider = payload.get("provider")
        model = payload.get("model")
        messages = payload.get("messages")
        if not isinstance(provider, str) or not isinstance(model, str) or not isinstance(messages, list):
            raise InvalidChatCompletionRequestError()
        return cls(provider=provider, model=model, messages=_parse_messages(messages))


class InvalidChatCompletionRequestError(ValueError):
    def __init__(self) -> None:
        super().__init__("messages must contain text role/content pairs")


class UnsupportedChatCompletionProviderError(RuntimeError):
    def __init__(self, provider: str) -> None:
        self.provider = provider
        super().__init__("chat-completion provider is not handled by Z.AI gateway")


class ZaiChatCompletionFailedError(RuntimeError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__("Z.AI chat completion failed")


class ZaiChatCompletionGateway:
    def __init__(self, adapter_factory: Callable[[], ZaiChatAdapter]) -> None:
        self._adapter_factory = adapter_factory

    def can_handle(self, provider: str) -> bool:
        return provider.lower() == "zai"

    async def create_chat_completion(self, request: ChatCompletionRequest) -> JsonObject:
        if not self.can_handle(request.provider):
            raise UnsupportedChatCompletionProviderError(provider=request.provider)
        try:
            result = await self._adapter_factory().create_chat_completion(
                model=request.model,
                messages=request.messages,
            )
        except ZaiAdapterError as exc:
            raise ZaiChatCompletionFailedError(code=exc.code) from None
        return _to_openai_response(result)


def build_zai_chat_gateway(
    auth_token: str,
    token_db_path: Path,
    user_id: str,
    fe_version: str = DEFAULT_FE_VERSION,
) -> ZaiChatCompletionGateway:
    def adapter_factory() -> ZaiAdapter:
        return ZaiAdapter(
            config=ZaiAdapterConfig(
                auth_token=auth_token,
                token_db_path=token_db_path,
                user_id=user_id,
                fe_version=fe_version,
            )
        )

    return ZaiChatCompletionGateway(adapter_factory=adapter_factory)


def _parse_messages(messages: list[JsonValue]) -> list[ZaiMessage]:
    parsed: list[ZaiMessage] = []
    for message in messages:
        if not isinstance(message, dict):
            raise InvalidChatCompletionRequestError()
        role = message.get("role")
        content = message.get("content")
        if not isinstance(role, str) or not isinstance(content, str):
            raise InvalidChatCompletionRequestError()
        parsed.append(ZaiMessage(role=role, content=content))
    return parsed


def _to_openai_response(result: ZaiChatResult) -> JsonObject:
    return {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": result.content,
                }
            }
        ]
    }
