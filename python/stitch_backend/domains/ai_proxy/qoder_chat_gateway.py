from __future__ import annotations

import platform
from dataclasses import dataclass
from typing import Final, TypedDict

import httpx

from stitch_backend.domains.ai_proxy.zai_chat_gateway import ChatCompletionRequest, JsonObject

_DEFAULT_ENDPOINT: Final = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
_QODER_VERSION: Final = "0.15.9"


@dataclass(frozen=True, slots=True)
class QoderCredentials:
    api_key: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None


@dataclass(frozen=True, slots=True)
class QoderProviderError(Exception):
    code: str

    def __str__(self) -> str:
        return "Qoder provider request failed"


QoderHeaders = TypedDict(
    "QoderHeaders",
    {
        "Content-Type": str,
        "Authorization": str,
        "x-dashscope-authtype": str,
        "x-dashscope-cachecontrol": str,
        "user-agent": str,
        "x-dashscope-useragent": str,
        "x-stainless-arch": str,
        "x-stainless-lang": str,
        "x-stainless-os": str,
    },
)


def resolve_qoder_token(credentials: QoderCredentials) -> str:
    for token in (credentials.api_key, credentials.access_token, credentials.refresh_token):
        if token and token.strip():
            return token.strip()
    return ""


def build_qoder_headers(token: str, *, platform_name: str | None = None, machine: str | None = None) -> QoderHeaders:
    selected_platform = platform_name or platform.system().lower()
    selected_machine = machine or platform.machine()
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "x-dashscope-authtype": "qwen-oauth",
        "x-dashscope-cachecontrol": "enable",
        "user-agent": f"QwenCode/{_QODER_VERSION} ({selected_platform}; {selected_machine})",
        "x-dashscope-useragent": f"QwenCode/{_QODER_VERSION} ({selected_platform}; {selected_machine})",
        "x-stainless-arch": _stainless_arch(selected_machine),
        "x-stainless-lang": "js",
        "x-stainless-os": _stainless_os(selected_platform),
    }


class QoderAdapter:
    def __init__(self, *, client: httpx.AsyncClient, credentials: QoderCredentials) -> None:
        self._client = client
        self._credentials = credentials

    async def create_chat_completion(self, request: ChatCompletionRequest) -> JsonObject:
        token = resolve_qoder_token(self._credentials)
        if not token:
            raise QoderProviderError("token_required")
        payload = {
            "model": _map_model(request.model),
            "messages": [{"role": message.role, "content": message.content} for message in request.messages],
            "stream": False,
        }
        try:
            response = await self._client.post(
                _DEFAULT_ENDPOINT,
                headers=build_qoder_headers(token),
                json=payload,
            )
        except httpx.HTTPError as exc:
            raise QoderProviderError("transport_error") from exc
        if response.status_code < 200 or response.status_code >= 300:
            raise QoderProviderError(f"upstream_{response.status_code}")
        try:
            data = response.json()
        except ValueError as exc:
            raise QoderProviderError("invalid_response") from exc
        if not isinstance(data, dict):
            raise QoderProviderError("invalid_response")
        return data

    async def close(self) -> None:
        await self._client.aclose()


def _map_model(model: str) -> str:
    match model:
        case "qwen3.5-plus" | "qwen3.6-plus":
            return "coder-model"
        case "vision-model":
            return "qwen3-vl-plus"
        case _:
            return model or "qwen3-coder-plus"


def _stainless_arch(machine: str) -> str:
    match machine:
        case "x86_64" | "x64":
            return "x64"
        case "aarch64" | "arm64":
            return "arm64"
        case _:
            return machine


def _stainless_os(platform_name: str) -> str:
    match platform_name.lower():
        case "darwin":
            return "MacOS"
        case "win32" | "windows":
            return "Windows"
        case "linux":
            return "Linux"
        case _:
            return platform_name
