"""Generic adapter for plugin-managed loopback bridges.

Service plugins (stitch-ramp, stitch-quickwork, …) run a loopback
OpenAI-compatible bridge and publish a gateway bundle via the
``get_gateway_provider`` RPC; the ``plugin_bridge`` worker syncs it into
ProviderEndpoint/Credential/PublicModel rows.  This adapter is the
vendor-parameterized twin of ``VellyAdapter``: the public model alias is
``<vendor>/<model>`` and transport failures classify as endpoint-wide so
a stopped bridge cooldowns the whole endpoint, not one model.
"""

from __future__ import annotations

import json
from typing import Any

from stitch_backend.domains.ai_gateway.adapters.base import (
    ClassifiedError,
    get_adapter,
    register_adapter,
)
from stitch_backend.domains.ai_gateway.adapters.configurable import ConfigurableAdapter

_PROTOCOL_PATHS = {
    "chat": "/v1/chat/completions",
    "messages": "/v1/messages",
    "responses": "/v1/responses",
}


class PluginBridgeAdapter(ConfigurableAdapter):
    def __init__(self, vendor: str, protocol: str) -> None:
        self.vendor = vendor
        self.protocol = protocol
        super().__init__(invoke_path=_PROTOCOL_PATHS[protocol])

    async def invoke(
        self,
        *,
        base_url: str,
        secret: str,
        model: str,
        messages: list,
        stream: bool = False,
        default_headers: dict | None = None,
        **kwargs: Any,
    ) -> Any:
        import litellm

        params = dict(kwargs)
        params.setdefault("max_tokens", 4096)
        provider = "anthropic" if self.protocol == "messages" else "openai"
        sdk_model = f"responses/{model}" if self.protocol == "responses" else f"{provider}/{model}"
        sdk_base = base_url.removesuffix("/v1") if self.protocol == "messages" else base_url
        response = await litellm.acompletion(
            model=sdk_model,
            custom_llm_provider=provider,
            messages=messages,
            stream=True if self.protocol == "responses" else stream,
            api_base=sdk_base,
            api_key=secret,
            extra_headers=default_headers or {},
            max_retries=0,
            timeout=600,
            **params,
        )
        if stream:
            return self._chat_stream(response, model)
        if self.protocol == "responses":
            chunks = [chunk async for chunk in response]
            response = litellm.stream_chunk_builder(chunks, messages=messages)
        data = response.model_dump(mode="json", exclude_none=True)
        data["model"] = f"{self.vendor}/{model}"
        return data

    async def _chat_stream(self, response: Any, model: str) -> Any:
        async for chunk in response:
            data = chunk.model_dump(mode="json", exclude_none=True)
            data["model"] = f"{self.vendor}/{model}"
            yield "data: " + json.dumps(data)
        yield "data: [DONE]"

    async def invoke_messages(self, **kwargs: Any) -> Any:
        if self.protocol != "messages":
            raise ValueError("This model requires the Chat Completions or Responses route")
        return await super().invoke(**kwargs)

    async def invoke_responses(self, **kwargs: Any) -> Any:
        if self.protocol != "responses":
            raise ValueError("This model requires the Chat Completions or Messages route")
        return await super().invoke_responses(**kwargs)

    def classify_error(
        self,
        exc: BaseException,
        *,
        http_status: int | None = None,
        response_headers: dict[str, str] | None = None,
        response_body: str | None = None,
    ) -> ClassifiedError:
        status = (
            http_status
            or getattr(exc, "status_code", None)
            or getattr(getattr(exc, "response", None), "status_code", None)
        )
        result = super().classify_error(
            exc, http_status=status, response_headers=response_headers, response_body=response_body
        )
        # A bridge process dies as a whole: connection/timeout failures are
        # endpoint-wide, never model-specific.
        if type(exc).__name__ in {"APIConnectionError", "Timeout", "APITimeoutError"}:
            return ClassifiedError(category="transport_error", is_endpoint_wide=True)
        if result.category in {
            "server_error",
            "model_not_found",
            "model_access_denied",
            "client_error",
        } or status in (403, 429):
            result.is_model_specific = True
            result.is_endpoint_wide = False
        return result


def ensure_bridge_adapter(vendor: str, protocol: str) -> str:
    """Register ``<vendor>_<protocol>`` adapter if absent; returns the key."""
    key = f"{vendor}_{protocol}"
    try:
        get_adapter(key)
    except KeyError:
        register_adapter(key, PluginBridgeAdapter(vendor, protocol))
    return key
