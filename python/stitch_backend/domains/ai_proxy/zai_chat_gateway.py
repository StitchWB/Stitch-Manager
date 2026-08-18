from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol, TypeAlias

from stitch_backend.domains.ai_proxy.zai_adapter import (
    DEFAULT_FE_VERSION,
    ZaiAdapter,
    ZaiAdapterConfig,
    ZaiAdapterError,
    ZaiChatResult,
    ZaiMessage,
)

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

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
    tools: list[JsonObject] | None = None
    tool_choice: JsonValue = None
    # Original payload message dicts (role/content/tool_calls/name) — needed
    # by web adapters whose prompt builders consume the raw OpenAI shape
    # (ZaiMessage carries role/content only).
    raw_messages: list[JsonObject] | None = None

    @classmethod
    def from_openai_payload(cls, payload: JsonObject) -> ChatCompletionRequest:
        provider = payload.get("provider")
        model = payload.get("model")
        messages = payload.get("messages")
        if not isinstance(model, str) or not isinstance(messages, list):
            raise InvalidChatCompletionRequestError()
        if not isinstance(provider, str):
            # Web-bridge providers may be derived from the model prefix when
            # the explicit field is absent (IDE clients send model only).
            # Legacy providers still require the explicit field (422 below).
            if model.startswith("web-") and "/" in model:
                provider, model = model.split("/", 1)
            else:
                raise InvalidChatCompletionRequestError()
        elif provider.startswith("web-") and model.startswith(f"{provider}/"):
            model = model[len(provider) + 1 :]
        if provider.startswith("web-"):
            # OpenAI-conformant tool round-trips send assistant tool-call
            # messages with content=null; map to "" for web bridges only so
            # multi-turn tool use works (zai/qoder keep strict 422 behavior).
            messages = [
                {**m, "content": ""}
                if isinstance(m, dict) and m.get("content") is None
                else m
                for m in messages
            ]
        tools = payload.get("tools")
        return cls(
            provider=provider,
            model=model,
            messages=_parse_messages(messages),
            tools=(
                [t for t in tools if isinstance(t, dict)]
                if isinstance(tools, list)
                else None
            ),
            tool_choice=payload.get("tool_choice"),
            raw_messages=[m for m in messages if isinstance(m, dict)],
        )


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
