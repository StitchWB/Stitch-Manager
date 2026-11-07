"""Anthropic Messages adapter: real transport with dual auth headers.

``api.anthropic.com`` accepts either ``x-api-key`` or ``Authorization: Bearer``;
the Anthropic-compatible Z.AI gateway (``api.z.ai/api/anthropic``) requires BOTH
carrying the same value, so this adapter always sends the pair.

OpenAI-shaped input (chat route) is translated by litellm, which also handles
images, tools and streaming. The native ``/v1/messages`` route already speaks
Anthropic, so the body is passed through unchanged.
"""

from __future__ import annotations

import json
from typing import Any

from stitch_backend.domains.ai_gateway.adapters.base import (
    AdapterCapabilities,
    register_adapter,
    register_adapter_capabilities,
)
from stitch_backend.domains.ai_gateway.adapters.configurable import ConfigurableAdapter

_ANTHROPIC_VERSION = "2023-06-01"
_DEFAULT_MAX_TOKENS = 4096


class AnthropicMessagesAdapter(ConfigurableAdapter):
    def __init__(self) -> None:
        super().__init__(
            auth_header_name="x-api-key",
            auth_prefix="",
            invoke_path="/v1/messages",
            extra_headers={"anthropic-version": _ANTHROPIC_VERSION},
        )

    @staticmethod
    def _dual_auth(secret: str, default_headers: dict[str, str] | None) -> dict[str, str]:
        headers = dict(default_headers or {})
        headers.setdefault("anthropic-version", _ANTHROPIC_VERSION)
        if secret:
            headers["Authorization"] = f"Bearer {secret}"
        return headers

    async def invoke(
        self,
        *,
        base_url: str,
        secret: str,
        model: str,
        messages: list[dict[str, Any]],
        stream: bool = False,
        default_headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> Any:
        import litellm

        params = dict(kwargs)
        params.setdefault("max_tokens", _DEFAULT_MAX_TOKENS)
        response = await litellm.acompletion(
            model=f"anthropic/{model}",
            custom_llm_provider="anthropic",
            messages=messages,
            stream=stream,
            api_base=base_url.removesuffix("/v1"),
            api_key=secret,
            extra_headers=self._dual_auth(secret, default_headers),
            max_retries=0,
            timeout=600,
            **params,
        )
        if stream:
            return self._chat_stream(response)
        return response.model_dump(mode="json", exclude_none=True)

    @staticmethod
    async def _chat_stream(response: Any) -> Any:
        async for chunk in response:
            yield "data: " + json.dumps(chunk.model_dump(mode="json", exclude_none=True))
        yield "data: [DONE]"

    async def invoke_messages(
        self,
        *,
        base_url: str,
        secret: str,
        model: str,
        messages: list[dict[str, Any]],
        stream: bool = False,
        default_headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> Any:
        return await ConfigurableAdapter.invoke(
            self,
            base_url=base_url,
            secret=secret,
            model=model,
            messages=messages,
            stream=stream,
            default_headers=self._dual_auth(secret, default_headers),
            **kwargs,
        )


register_adapter("anthropic", AnthropicMessagesAdapter())
register_adapter_capabilities(
    AdapterCapabilities(
        adapter_type="anthropic",
        limitations=(
            "the OpenAI chat route is translated by litellm (max_tokens defaults "
            "to 4096); /v1/messages passes an Anthropic body through unchanged",
        ),
    )
)
