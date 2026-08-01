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
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlparse, urlunparse

import httpx

from stitch_backend.domains.ai_gateway.adapters.base import (
    ClassifiedError,
    ProbeResult,
    register_adapter,
)
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error

_PROBE_TIMEOUT_SECONDS = 10.0

# Streaming: 30s connect, 300s total read.  Prevents hung connections
# from blocking a coroutine indefinitely.
_STREAM_TIMEOUT = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=30.0)

_TRANSPORT_ERROR_TYPE_NAMES = {
    "ConnectError", "ConnectTimeout", "ReadTimeout", "WriteTimeout",
    "PoolTimeout", "InvalidURL", "ProxyError", "UnsupportedProtocol",
    "NetworkError",
}


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
    ) -> None:
        self._auth_header_name = auth_header_name
        self._auth_prefix = auth_prefix
        self._auth_query_param = auth_query_param
        self._models_path = models_path
        self._invoke_path = invoke_path
        self._extra_headers = extra_headers or {}

    # ── URL / header builders ────────────────────────────────────────────────

    def _build_url(self, base_url: str, secret: str, path: str) -> str:
        stripped = base_url.rstrip("/")
        # Strip /v1 from base_url if path already starts with it
        if stripped.endswith("/v1") and path.startswith("/v1"):
            path = path[3:] or "/"
        url = f"{stripped}{path}"
        if self._auth_query_param is not None:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}{self._auth_query_param}={secret}"
        return url

    def _build_headers(self, secret: str, default_headers: dict[str, str] | None) -> dict[str, str]:
        headers: dict[str, str] = {**self._extra_headers, **(default_headers or {})}
        if self._auth_query_param is None:
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
            models = _parse_model_ids(resp)
            return ProbeResult(success=True, latency_ms=latency_ms, models=models, http_status=200)
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
        result = await self.probe_credential(
            base_url=base_url, secret=secret, default_headers=default_headers,
        )
        if not result.success:
            raise RuntimeError(result.error or f"HTTP {result.http_status}")
        return result.models or []

    async def _discover(
        self,
        *,
        base_url: str,
        secret: str,
        default_headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        headers = self._build_headers(secret, default_headers)
        url = self._models_url(base_url, secret)
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT_SECONDS, follow_redirects=False) as client:
            return await client.get(url, headers=headers)

    # ── Invoke ───────────────────────────────────────────────────────────────

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
        url = self._invoke_url(base_url, secret)
        headers = self._build_headers(secret, default_headers)
        payload: dict[str, Any] = {"model": model, "messages": messages, "stream": stream, **kwargs}

        if not stream:
            async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT_SECONDS, follow_redirects=False) as client:
                resp = await client.post(url, headers=headers, json=payload)
                resp.raise_for_status()
                return resp.json()

        return self._stream_invoke(url, headers, payload)

    @staticmethod
    async def _stream_invoke(
        url: str, headers: dict[str, str], payload: dict[str, Any],
    ) -> AsyncIterator[str]:
        async with httpx.AsyncClient(timeout=_STREAM_TIMEOUT, follow_redirects=False) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
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
        url = self._invoke_url(base_url, secret)
        headers = self._build_headers(secret, default_headers)
        payload: dict[str, Any] = {"model": model, "input": input, "stream": stream, **kwargs}

        if not stream:
            async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT_SECONDS, follow_redirects=False) as client:
                resp = await client.post(url, headers=headers, json=payload)
                resp.raise_for_status()
                return resp.json()

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

        if status is None:
            if _is_transport_failure(exc):
                return ClassifiedError(category="transport_error", is_endpoint_wide=True)
            return ClassifiedError(category="unknown", is_endpoint_wide=False)

        retry_after = _parse_retry_after(headers)
        lowered_body = body_text.lower()

        if status in (401, 403):
            category = "auth_failed"
        elif status == 429:
            category = "rate_limited"
        elif status == 404 and "model" in lowered_body:
            category = "model_not_found"
        elif status == 402 or "quota" in lowered_body or "insufficient" in lowered_body:
            category = "quota_exhausted"
        elif 500 <= status < 600:
            category = "server_error"
        elif status == 400:
            category = "client_error"
        else:
            category = "unknown"

        return ClassifiedError(
            category=category,
            retry_after_seconds=retry_after,
            is_endpoint_wide=(category == "server_error"),
        )


# ── Helpers ──────────────────────────────────────────────────────────────────


def _parse_model_ids(resp: httpx.Response) -> list[str]:
    try:
        data = resp.json()
    except ValueError:
        return []
    items = data.get("data", []) if isinstance(data, dict) else []
    return [item["id"] for item in items if isinstance(item, dict) and item.get("id")]


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

register_adapter("anthropic", ConfigurableAdapter(
    auth_header_name="x-api-key",
    auth_prefix="",
    invoke_path="/v1/messages",
    extra_headers={"anthropic-version": "2023-06-01"},
))

register_adapter("gemini", ConfigurableAdapter(
    auth_query_param="key",
    models_path="/v1beta/models",
))
