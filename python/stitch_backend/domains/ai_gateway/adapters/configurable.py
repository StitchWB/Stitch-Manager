"""One adapter class, configured per-protocol — covers OpenAI, Anthropic, Gemini.

The wire-protocol differences between these providers reduce to:

    - auth delivery (Bearer header / x-api-key header / ?key= query param)
    - models discovery path (/v1/models vs /v1beta/models)
    - a handful of extra required headers (anthropic-version)

Everything else — error classification, transport-failure detection,
Retry-After parsing — is identical.  So instead of three near-identical
classes we have one ``ConfigurableAdapter`` registered under three names.

Adding a new OpenAI-compatible endpoint (Fireworks, DashScope, a self-hosted
vLLM, ...) never requires a new adapter — only a new ``ProviderEndpoint`` row
with ``adapter_type="openai_compatible"`` and its own ``base_url``.

Kiro is the only provider that genuinely needs its own adapter class
(custom OAuth + machine_id rotation) — that is out of scope here.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any, cast

import httpx

from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.ai_gateway.adapters.base import (
    AdapterCapabilities,
    ClassifiedError,
    ModelMetadata,
    ProbeResult,
    register_adapter,
    register_adapter_capabilities,
)
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

_PROBE_TIMEOUT_SECONDS = 10.0

# Streaming: 30s connect, 300s total read.  Prevents hung connections
# from blocking a coroutine indefinitely.
_STREAM_TIMEOUT = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=30.0)

# Keep-alive pool shared by every adapter call so a TLS handshake is not paid per request.
_HTTP_LIMITS = httpx.Limits(
    max_keepalive_connections=20,
    max_connections=100,
    keepalive_expiry=30.0,
)

_shared_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient(
            limits=_HTTP_LIMITS,
            headers={"Connection": "keep-alive"},
            follow_redirects=False,
        )
    return _shared_client


async def aclose_http_client() -> None:
    global _shared_client
    if _shared_client is not None:
        await _shared_client.aclose()
        _shared_client = None


_TRANSPORT_ERROR_TYPE_NAMES = {
    "ConnectError", "ConnectTimeout", "ReadTimeout", "WriteTimeout",
    "PoolTimeout", "InvalidURL", "ProxyError", "UnsupportedProtocol",
    "NetworkError",
}

# Some vendors bill quota/auth as generic statuses (quota as 429, bad key as 400).
_AUTH_SIGNALS = (
    "incorrect api key", "invalid api key", "invalid_api_key",
    "authentication_error", "invalid authentication", "invalid token",
    "unauthenticated", "no auth credentials",
)
_QUOTA_SIGNALS = (
    "insufficient_quota", "exceeded your current quota", "insufficient balance",
    "insufficient funds", "insufficient credit", "credit balance", "no credit",
    "out of credit", "quota exceeded", "quota",
)
_MODEL_SIGNALS = (
    "model_not_found", "no such model", "model not found", "does not exist",
    "do not have access", "model_access_denied", "not have access to model",
    "permission to access model",
)
_RATE_SIGNALS = ("rate limit", "rate_limit", "too many requests", "requests per")


def _contains(text: str, signals: tuple[str, ...]) -> bool:
    return any(signal in text for signal in signals)


def _classify_status(status: int, lowered_body: str) -> tuple[str, bool]:
    """Map an HTTP status + body to ``(category, is_model_specific)``."""
    if status == 401:
        return "auth_failed", False
    if status == 403:
        if _contains(lowered_body, _MODEL_SIGNALS):
            return "model_access_denied", True
        return "auth_failed", False
    if _contains(lowered_body, _AUTH_SIGNALS):
        return "auth_failed", False
    if status == 402 or _contains(lowered_body, _QUOTA_SIGNALS):
        return "quota_exhausted", False
    if status == 429:
        return "rate_limited", False
    if 500 <= status < 600:
        return "server_error", True
    if status == 404 and "model" in lowered_body:
        return "model_not_found", True
    if status == 400:
        return "client_error", False
    return "unknown", False


def _category_from_body(lowered_body: str) -> str:
    """Classify an exception carrying no HTTP status from its message text."""
    if _contains(lowered_body, _QUOTA_SIGNALS):
        return "quota_exhausted"
    if _contains(lowered_body, _AUTH_SIGNALS):
        return "auth_failed"
    if _contains(lowered_body, _RATE_SIGNALS):
        return "rate_limited"
    if _contains(lowered_body, _MODEL_SIGNALS):
        return "model_access_denied"
    return "unknown"


class ConfigurableAdapter:
    """Protocol adapter configured via constructor — one class, many registrations."""

    def __init__(
        self,
        *,
        auth_header_name: str = "Authorization",
        auth_prefix: str = "Bearer ",
        auth_query_param: str | None = None,
        models_path: str = "/v1/models",
        invoke_path: str = "/v1/chat/completions",
        extra_headers: dict[str, str] | None = None,
        supports_chat: bool = True,
    ) -> None:
        self._auth_header_name = auth_header_name
        self._auth_prefix = auth_prefix
        self._auth_query_param = auth_query_param
        self._models_path = models_path
        self._invoke_path = invoke_path
        self._extra_headers = extra_headers or {}
        self._supports_chat = supports_chat

    # ── URL / header builders ────────────────────────────────────────────────

    def _build_url(self, base_url: str, secret: str, path: str) -> str:
        stripped = base_url.rstrip("/")
        # Strip a version suffix (/v1, /v1beta) from base_url when path repeats it.
        for prefix in ("/v1beta", "/v1"):
            if stripped.endswith(prefix) and path.startswith(prefix):
                path = path[len(prefix):] or "/"
                break
        url = f"{stripped}{path}"
        if self._auth_query_param is not None and secret:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}{self._auth_query_param}={secret}"
        return url

    def _build_headers(self, secret: str, default_headers: dict[str, str] | None) -> dict[str, str]:
        headers: dict[str, str] = {**self._extra_headers, **(default_headers or {})}
        # Empty secret means auth_type "none" — omit the auth header entirely.
        if self._auth_query_param is None and secret:
            headers[self._auth_header_name] = f"{self._auth_prefix}{secret}"
        return headers

    def _models_url(self, base_url: str, secret: str) -> str:
        return self._build_url(base_url, secret, self._models_path)

    def _invoke_url(self, base_url: str, secret: str) -> str:
        return self._build_url(base_url, secret, self._invoke_path)

    # ── Discovery / health-check ─────────────────────────────────────────────

    async def probe_credential(
        self,
        *,
        base_url: str,
        secret: str,
        default_headers: dict[str, str] | None = None,
    ) -> ProbeResult:
        start = time.monotonic()
        try:
            resp = await self._discover(
                base_url=base_url, secret=secret, default_headers=default_headers,
            )
        except Exception as exc:  # noqa: BLE001
            latency_ms = (time.monotonic() - start) * 1000
            return ProbeResult(success=False, latency_ms=latency_ms, error=_sanitize_error(exc, secret))

        latency_ms = (time.monotonic() - start) * 1000
        if resp.status_code == 200:
            metadata = _parse_model_metadata(resp)
            return ProbeResult(
                success=True, latency_ms=latency_ms,
                models=[m.id for m in metadata], model_metadata=metadata,
                http_status=200,
            )
        return ProbeResult(
            success=False, latency_ms=latency_ms,
            http_status=resp.status_code, error=f"HTTP {resp.status_code}",
        )

    async def list_models(
        self,
        *,
        base_url: str,
        secret: str,
        default_headers: dict[str, str] | None = None,
    ) -> list[str]:
        return [m.id for m in await self.list_models_detailed(
            base_url=base_url, secret=secret, default_headers=default_headers,
        )]

    async def list_models_detailed(
        self,
        *,
        base_url: str,
        secret: str,
        default_headers: dict[str, str] | None = None,
    ) -> list[ModelMetadata]:
        result = await self.probe_credential(
            base_url=base_url, secret=secret, default_headers=default_headers,
        )
        if not result.success:
            raise RuntimeError(result.error or f"HTTP {result.http_status}")
        return result.model_metadata or []

    async def _discover(
        self,
        *,
        base_url: str,
        secret: str,
        default_headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        headers = self._build_headers(secret, default_headers)
        url = self._models_url(base_url, secret)
        return await get_http_client().get(url, headers=headers, timeout=_PROBE_TIMEOUT_SECONDS)

    # ── Invoke ───────────────────────────────────────────────────────────────

    def _ensure_chat_supported(self) -> None:
        if not self._supports_chat:
            raise StitchError(
                "chat/responses invocation is not supported by this adapter — "
                "only model discovery is implemented for its wire protocol"
            )

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
    ) -> dict[str, Any] | AsyncIterator[str]:
        self._ensure_chat_supported()
        url = self._invoke_url(base_url, secret)
        headers = self._build_headers(secret, default_headers)
        payload: dict[str, Any] = {"model": model, "messages": messages, "stream": stream, **kwargs}

        if not stream:
            resp = await get_http_client().post(
                url, headers=headers, json=payload, timeout=_PROBE_TIMEOUT_SECONDS,
            )
            resp.raise_for_status()
            return cast("dict[str, Any]", resp.json())

        return self._stream_invoke(url, headers, payload)

    @staticmethod
    async def _stream_invoke(
        url: str, headers: dict[str, str], payload: dict[str, Any],
    ) -> AsyncIterator[str]:
        client = get_http_client()
        async with client.stream(
            "POST", url, headers=headers, json=payload, timeout=_STREAM_TIMEOUT,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line:
                    yield line

    async def invoke_responses(
        self,
        *,
        base_url: str,
        secret: str,
        model: str,
        input: Any,
        stream: bool = False,
        default_headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any] | AsyncIterator[str]:
        """Invoke the Responses API (OpenAI-specific).

        Unlike ``invoke`` which sends ``messages``, this sends ``input``
        as the primary content field.  The payload is
        ``{"model": ..., "input": ..., "stream": ..., **kwargs}`` — no
        ``messages`` key is included.
        """
        self._ensure_chat_supported()
        url = self._invoke_url(base_url, secret)
        headers = self._build_headers(secret, default_headers)
        payload: dict[str, Any] = {"model": model, "input": input, "stream": stream, **kwargs}

        if not stream:
            resp = await get_http_client().post(
                url, headers=headers, json=payload, timeout=_PROBE_TIMEOUT_SECONDS,
            )
            resp.raise_for_status()
            return cast("dict[str, Any]", resp.json())

        return self._stream_invoke(url, headers, payload)

    # ── Error classification ─────────────────────────────────────────────────

    def classify_error(
        self,
        exc: BaseException,
        *,
        http_status: int | None = None,
        response_headers: dict[str, str] | None = None,
    ) -> ClassifiedError:
        status = http_status
        headers = response_headers
        body_text = ""

        if isinstance(exc, httpx.HTTPStatusError):
            response = exc.response
            if status is None:
                status = response.status_code
            if headers is None:
                headers = dict(response.headers)
            body_text = _safe_response_text(response)
        else:
            body_text = str(exc)

        lowered_body = body_text.lower()

        if status is None:
            if _is_transport_failure(exc):
                return ClassifiedError(category="transport_error", is_endpoint_wide=True)
            return ClassifiedError(
                category=_category_from_body(lowered_body), is_endpoint_wide=False,
            )

        retry_after = _parse_retry_after(headers)
        category, model_specific = _classify_status(status, lowered_body)

        return ClassifiedError(
            category=category,
            retry_after_seconds=retry_after,
            is_endpoint_wide=(category == "server_error"),
            is_model_specific=model_specific,
        )


# ── Helpers ──────────────────────────────────────────────────────────────────


def _parse_model_metadata(resp: httpx.Response) -> list[ModelMetadata]:
    try:
        data = resp.json()
    except ValueError:
        return []
    items = data.get("data", []) if isinstance(data, dict) else []
    result: list[ModelMetadata] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        model_id = item.get("id")
        if not model_id:
            continue
        result.append(ModelMetadata(id=model_id, capabilities=_extract_capabilities(item)))
    return result


def _extract_capabilities(item: dict[str, Any]) -> dict[str, Any]:
    """Map provider-specific /v1/models fields onto canonical capability keys; absent = optimistic."""
    caps: dict[str, Any] = {}

    ctx = _first_int(item, "context_length", "max_model_len", "context_window", "max_input_tokens")
    if ctx is None:
        top = item.get("top_provider")
        if isinstance(top, dict):
            ctx = _first_int(top, "context_length", "max_model_len")
    if ctx is not None:
        caps["max_input_tokens"] = ctx

    vision = _first_bool(item, "supports_image_input", "supports_vision")
    if vision is None:
        arch = item.get("architecture")
        if isinstance(arch, dict):
            modalities = arch.get("input_modalities")
            if isinstance(modalities, list):
                vision = "image" in modalities
    if vision is not None:
        caps["supports_vision"] = vision

    tools = _first_bool(
        item, "supports_tool_calling", "supports_function_calling", "supports_tools",
    )
    if tools is None:
        params = item.get("supported_parameters")
        if isinstance(params, list):
            tools = "tools" in params or "tool_choice" in params
    if tools is not None:
        caps["supports_function_calling"] = tools

    streaming = _first_bool(item, "supports_streaming")
    if streaming is not None:
        caps["supports_streaming"] = streaming

    return caps


def _first_int(item: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = item.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


def _first_bool(item: dict[str, Any], *keys: str) -> bool | None:
    for key in keys:
        value = item.get(key)
        if isinstance(value, bool):
            return value
    return None


def _safe_response_text(response: httpx.Response) -> str:
    try:
        return response.text
    except Exception:  # noqa: BLE001
        return ""


def _parse_retry_after(headers: dict[str, str] | None) -> int | None:
    if not headers:
        return None
    raw = headers.get("Retry-After") or headers.get("retry-after")
    if raw is None:
        return None
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return None


def _is_transport_failure(exc: BaseException) -> bool:
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        if type(current).__name__ in _TRANSPORT_ERROR_TYPE_NAMES:
            return True
        seen.add(id(current))
        current = current.__cause__ or current.__context__
    return False


# ── Register three instances ────────────────────────────────────────────────

register_adapter("openai_compatible", ConfigurableAdapter())

register_adapter("gemini", ConfigurableAdapter(
    auth_query_param="key",
    models_path="/v1beta/models",
    supports_chat=False,
))

register_adapter_capabilities(AdapterCapabilities(
    adapter_type="openai_compatible",
    supports_none_auth=True,
    supports_responses=True,
))

register_adapter_capabilities(AdapterCapabilities(
    adapter_type="gemini",
    supports_chat=False,
    limitations=(
        "model discovery only (/v1beta/models); chat invoke would send an "
        "OpenAI payload that the native Gemini API does not serve — a native "
        "generateContent adapter is not implemented",
    ),
))
