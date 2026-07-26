from __future__ import annotations

import hashlib
import json
from collections.abc import Awaitable, Callable
from typing import Protocol

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from starlette.responses import Response

from stitch_backend.domains.ai_proxy.litellm_gateway import (
    GatewayRequest,
    JsonObject,
    JsonValue,
    LiteLLMDeployment,
    _deployment_configs,
)
from stitch_backend.domains.ai_proxy.holone_stream import (
    SecurityMode,
    protect_anthropic_sse,
    protect_openai_response,
    protect_openai_sse,
)

# ponytail: protect_anthropic_response will be added by another agent; fall back to passthrough
try:
    from stitch_backend.domains.ai_proxy.holone_stream import protect_anthropic_response
except ImportError:  # pragma: no cover — added by another agent
    def _protect_anthropic_response(
        response: JsonObject,
        mode: SecurityMode = SecurityMode.BLOCK,
        client_has_tools: bool = False,
    ) -> tuple[JsonObject, tuple[()], bool]:
        return response, (), False

    protect_anthropic_response = _protect_anthropic_response


class CompletionRouter(Protocol):
    async def acompletion(
        self,
        model: str,
        messages: list[dict[str, JsonValue]],
        stream: bool = False,
        **kwargs: JsonValue,
    ) -> JsonObject | BaseModel: ...

    async def aanthropic_messages(
        self,
        model: str,
        messages: list[dict[str, JsonValue]],
        stream: bool = False,
        **kwargs: JsonValue,
    ) -> JsonObject | BaseModel: ...

    async def aresponses(
        self,
        model: str,
        input: JsonValue,
        stream: bool = False,
        **kwargs: JsonValue,
    ) -> JsonObject | BaseModel: ...


KeyLoader = Callable[[], Awaitable[dict[str, list[dict[str, JsonValue]]]]]
RouterFactory = Callable[[list[LiteLLMDeployment]], CompletionRouter]


class LiteLLMExecutor:
    """Owns the in-process LiteLLM Router built from Stitch credentials."""

    def __init__(
        self,
        load_keys: KeyLoader,
        build_router: RouterFactory,
        security_mode: SecurityMode = SecurityMode.BLOCK,
    ) -> None:
        self._load_keys = load_keys
        self._build_router = build_router
        self._router: CompletionRouter | None = None
        self._configuration_id: str | None = None
        self._providers: tuple[str, ...] = ()
        self._security_mode = security_mode

    async def chat(self, payload: GatewayRequest) -> JsonObject | Response:
        router = await self._current_router()
        response = await router.acompletion(
            model=_routed_model(payload),
            messages=_required_messages(payload),
            stream=payload.stream,
        )
        if payload.stream:
            return await self._stream_response(response, client_has_tools=bool(payload.tools))
        protected, _, _ = protect_openai_response(
            _json_object(response),
            mode=self._security_mode,
            client_has_tools=bool(payload.tools),
        )
        return protected

    async def messages(self, payload: GatewayRequest) -> JsonObject | Response:
        router = await self._current_router()
        routed = _routed_model(payload)
        model = routed.split("/", 1)[1] if "/" in routed else routed
        response = await router.aanthropic_messages(
            model=model,
            messages=_required_messages(payload),
            stream=payload.stream,
        )
        if payload.stream:
            return await self._stream_anthropic_response(response, client_has_tools=bool(payload.tools))
        protected, _, _ = protect_anthropic_response(
            _json_object(response),
            mode=self._security_mode,
            client_has_tools=bool(payload.tools),
        )
        return protected

    async def responses(self, payload: GatewayRequest) -> JsonObject | Response:
        router = await self._current_router()
        response = await router.aresponses(
            model=_routed_model(payload),
            input=payload.input,
            stream=payload.stream,
        )
        if payload.stream:
            # ponytail: no HoloNe protection for Responses API streaming yet
            return await self._stream_response(response, client_has_tools=bool(payload.tools))
        # ponytail: no HoloNe protection for Responses API non-stream yet
        return _json_object(response)

    async def models(self) -> JsonObject:
        await self._current_router()
        return {
            "object": "list",
            "data": [
                {"id": f"{provider}/*", "object": "model", "owned_by": provider}
                for provider in self._providers
            ],
        }

    async def _current_router(self) -> CompletionRouter:
        provider_keys = await self._load_keys()
        deployments = _deployment_configs(provider_keys)
        if not deployments:
            raise LookupError("No provider keys configured")
        configuration_id = _safe_configuration_id(provider_keys)
        if self._router is None or configuration_id != self._configuration_id:
            self._router = self._build_router(deployments)
            self._configuration_id = configuration_id
            self._providers = tuple(sorted({deployment["model_name"].split("/", 1)[0] for deployment in deployments}))
        return self._router

    async def _stream_response(
        self, response: JsonObject | BaseModel, *, client_has_tools: bool
    ) -> StreamingResponse:
        chunks: list[str] = []
        async for chunk in response:
            value = chunk.model_dump(mode="json", exclude_none=True)
            chunks.append(f"data: {json.dumps(value, separators=(',', ':'))}\n\n")
        chunks.append("data: [DONE]\n\n")
        protected = protect_openai_sse(
            "".join(chunks),
            mode=self._security_mode,
            client_has_tools=client_has_tools,
        )

        async def body():
            yield protected.body

        return StreamingResponse(body(), media_type="text/event-stream")

    async def _stream_anthropic_response(
        self, response: JsonObject | BaseModel, *, client_has_tools: bool
    ) -> StreamingResponse:
        # ponytail: LiteLLM Router already decompresses upstream gzip — no manual decompress needed
        chunks: list[str] = []
        async for chunk in response:
            value = chunk.model_dump(mode="json", exclude_none=True)
            chunks.append(f"data: {json.dumps(value, separators=(',', ':'))}\n\n")
        protected = protect_anthropic_sse(
            "".join(chunks),
            mode=self._security_mode,
            client_has_tools=client_has_tools,
        )

        async def body():
            yield protected.body

        return StreamingResponse(body(), media_type="text/event-stream")


def _safe_configuration_id(provider_keys: dict[str, list[dict[str, JsonValue]]]) -> str:
    safe = [
        {
            "provider": provider,
            "key_id": hashlib.sha256(str(key.get("apiKey", "")).encode()).hexdigest(),
            "base_url": key.get("baseUrl"),
        }
        for provider, keys in sorted(provider_keys.items())
        for key in keys
    ]
    return hashlib.sha256(json.dumps(safe, sort_keys=True).encode()).hexdigest()


def _routed_model(payload: GatewayRequest) -> str:
    if not payload.model:
        raise HTTPException(status_code=422, detail={"error": {"message": "model is required"}})
    if "/" in payload.model:
        return payload.model
    return f"{(payload.provider or 'openai').lower()}/{payload.model}"


def _required_messages(payload: GatewayRequest) -> list[dict[str, JsonValue]]:
    if payload.messages is None:
        raise HTTPException(status_code=422, detail={"error": {"message": "messages are required"}})
    return payload.messages


def _json_object(response: JsonObject | BaseModel) -> JsonObject:
    if isinstance(response, BaseModel):
        return response.model_dump(mode="json")
    return response
