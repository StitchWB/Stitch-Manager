from __future__ import annotations

import json
from typing import Any

from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError, register_adapter
from stitch_backend.domains.ai_gateway.adapters.configurable import ConfigurableAdapter


class VellyAdapter(ConfigurableAdapter):
    def __init__(self, protocol: str) -> None:
        self.protocol = protocol
        super().__init__(invoke_path={
            "messages": "/v1/messages", "responses": "/v1/responses", "chat": "/v1/chat/completions",
        }[protocol])

    async def invoke(self, *, base_url: str, secret: str, model: str, messages: list,
                     stream: bool = False, default_headers: dict | None = None, **kwargs: Any) -> Any:
        import litellm

        params = dict(kwargs)
        params.setdefault("max_tokens", 4096)
        provider = "anthropic" if self.protocol == "messages" else "openai"
        sdk_model = f"responses/{model}" if self.protocol == "responses" else f"{provider}/{model}"
        sdk_base = base_url.removesuffix("/v1") if self.protocol == "messages" else base_url
        response = await litellm.acompletion(
            model=sdk_model,
            custom_llm_provider=provider,
            messages=messages, stream=True if self.protocol == "responses" else stream,
            api_base=sdk_base, api_key=secret, extra_headers=default_headers or {},
            max_retries=0, timeout=600, **params,
        )
        if stream:
            return self._chat_stream(response, model)
        if self.protocol == "responses":
            chunks = [chunk async for chunk in response]
            response = litellm.stream_chunk_builder(chunks, messages=messages)
        data = response.model_dump(mode="json", exclude_none=True)
        data["model"] = f"velly/{model}"
        return data

    @staticmethod
    async def _chat_stream(response: Any, model: str) -> Any:
        async for chunk in response:
            data = chunk.model_dump(mode="json", exclude_none=True)
            data["model"] = f"velly/{model}"
            yield "data: " + json.dumps(data)
        yield "data: [DONE]"

    async def invoke_messages(self, **kwargs: Any) -> Any:
        if self.protocol != "messages":
            raise ValueError("This Velly model requires the Responses or Chat Completions route")
        return await super().invoke(**kwargs)

    async def invoke_responses(self, **kwargs: Any) -> Any:
        if self.protocol != "responses":
            raise ValueError("This Velly model requires the Messages or Chat Completions route")
        return await super().invoke_responses(**kwargs)

    def classify_error(self, exc: BaseException, *, http_status: int | None = None,
                       response_headers: dict[str, str] | None = None) -> ClassifiedError:
        status = http_status or getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
        result = super().classify_error(exc, http_status=status, response_headers=response_headers)
        if type(exc).__name__ in {"APIConnectionError", "Timeout", "APITimeoutError"}:
            return ClassifiedError(category="transport_error", is_endpoint_wide=True)
        if result.category in {"server_error", "model_not_found", "model_access_denied", "client_error"} or status in (403, 429):
            result.is_model_specific = True
            result.is_endpoint_wide = False
        return result


for _protocol in ("messages", "responses", "chat"):
    register_adapter(f"velly_{_protocol}", VellyAdapter(_protocol))
