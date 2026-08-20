from __future__ import annotations

import hmac
import logging
import time
from typing import TYPE_CHECKING, Any, Protocol, TypedDict

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from stitch_backend.domains.ai_gateway.routing_engine import PoolScope

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from starlette.responses import Response

logger = logging.getLogger(__name__)

JsonScalar = str | int | float | bool | None
JsonValue = Any
JsonObject = dict[str, Any]


class GatewayRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="allow")

    model: str | None = None
    provider: str | None = None
    messages: list[dict[str, JsonValue]] | None = None
    input: JsonValue = None
    stream: bool = False
    tools: list[dict[str, JsonValue]] | None = None

    def sdk_payload(self) -> JsonObject:
        return self.model_dump(mode="json", exclude_none=True)


class NativeGatewayExecutor(Protocol):
    async def chat(self, payload: GatewayRequest, pool: PoolScope | None = None) -> JsonObject | Response: ...

    async def messages(self, payload: GatewayRequest, pool: PoolScope | None = None) -> JsonObject | Response: ...

    async def responses(self, payload: GatewayRequest, pool: PoolScope | None = None) -> JsonObject | Response: ...

    async def models(self, pool: PoolScope | None = None) -> JsonObject: ...


class GatewaySettings(Protocol):
    litellm_gateway_enabled: bool
    litellm_gateway_local_api_key: str | None


class StoredApiKey(BaseModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True)

    api_key: str
    base_url: str | None = None
    model_prefix: str | None = None


class LiteLLMParams(TypedDict, total=False):
    model: str
    api_key: str
    api_base: str


class LiteLLMDeployment(TypedDict):
    model_name: str
    litellm_params: LiteLLMParams


_UNSUPPORTED_ADAPTERS = frozenset({"kiro", "windsurf"})
_LITELLM_PROVIDER_MODELS = {
    "openai": "openai/*",
    "anthropic": "anthropic/*",
    "gemini": "gemini/*",
    "fireworks": "fireworks_ai/*",
    "antigravity": "openai/*",
    "dashscope": "openai/*",
}


def _deployment_configs(
    provider_keys: dict[str, list[dict[str, JsonValue]]],
) -> list[LiteLLMDeployment]:
    deployments: list[LiteLLMDeployment] = []

    # Extract custom providers metadata (stored under special key)
    custom_providers_meta = provider_keys.pop("__custom_providers__", [])

    # Built-in providers
    for provider, keys in provider_keys.items():
        if provider.startswith("custom_"):
            continue  # Skip custom provider keys in built-in loop
        model = _LITELLM_PROVIDER_MODELS.get(provider)
        if model is None:
            continue
        for stored in keys:
            api_key = stored.get("apiKey")
            if not isinstance(api_key, str) or not api_key.strip():
                continue
            params = LiteLLMParams(model=model, api_key=api_key)
            base_url = stored.get("baseUrl")
            if isinstance(base_url, str) and base_url.strip():
                params["api_base"] = base_url
            deployments.append(
                LiteLLMDeployment(
                    model_name=f"{provider}/*",
                    litellm_params=params,
                )
            )

    # Custom providers
    if isinstance(custom_providers_meta, list):
        for cp in custom_providers_meta:
            if not isinstance(cp, dict):
                continue
            cp_id = cp.get("id")
            cp_name = cp.get("name", "custom")
            cp_base_url = cp.get("base_url")
            cp_model = cp.get("litellm_model", "openai/*")
            if not isinstance(cp_id, str) or not isinstance(cp_base_url, str):
                continue
            cp_keys = provider_keys.get(f"custom_{cp_id}", [])
            for stored in cp_keys:
                api_key = stored.get("apiKey")
                if not isinstance(api_key, str) or not api_key.strip():
                    continue
                params = LiteLLMParams(
                    model=cp_model if isinstance(cp_model, str) else "openai/*",
                    api_key=api_key,
                    api_base=cp_base_url,
                )
                deployments.append(
                    LiteLLMDeployment(
                        model_name=f"{cp_name}/*",
                        litellm_params=params,
                    )
                )

    return deployments


def create_native_gateway_router(
    executor_factory: Callable[[], NativeGatewayExecutor],
    local_api_key: str | None = None,
    *,
    auth_resolver: Callable[[], str | None] | None = None,
    pool_resolver: Callable[[Request, str | None], Awaitable[PoolScope]] | None = None,
) -> APIRouter:
    """Build Stitch's in-process OpenAI/Anthropic-compatible gateway routes.

    Authentication uses either a static ``local_api_key`` (backward compat for
    the kiro gateway and tests) or a request-time ``auth_resolver`` callable
    (used by the litellm gateway to read the per-install token on each request,
    avoiding capturing it at construction time before the lifespan loads it).

    When ``pool_resolver`` is provided, it replaces ``_require_auth`` and
    resolves both authentication AND the caller's :class:`PoolScope` (proxy
    key → web session → local install token).  When ``None``, the legacy
    ``_require_auth`` path is used and the pool defaults to desktop.
    """
    router = APIRouter(prefix="/v1", tags=["Native AI Gateway"])

    @router.post("/chat/completions", response_model=None)
    async def chat_completions(
        payload: GatewayRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> JsonObject | Response:
        pool = await _resolve_pool(request, authorization, pool_resolver, local_api_key, auth_resolver)
        unsupported = _unsupported_adapter_response(payload)
        if unsupported is not None:
            return unsupported
        return await executor_factory().chat(payload, pool=pool)

    @router.post("/messages", response_model=None)
    async def messages(
        payload: GatewayRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> JsonObject | Response:
        pool = await _resolve_pool(request, authorization, pool_resolver, local_api_key, auth_resolver)
        unsupported = _unsupported_adapter_response(payload)
        if unsupported is not None:
            return unsupported
        return await executor_factory().messages(payload, pool=pool)

    @router.post("/responses", response_model=None)
    async def responses(
        payload: GatewayRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> JsonObject | Response:
        pool = await _resolve_pool(request, authorization, pool_resolver, local_api_key, auth_resolver)
        unsupported = _unsupported_adapter_response(payload)
        if unsupported is not None:
            return unsupported
        return await executor_factory().responses(payload, pool=pool)

    @router.get("/models")
    async def models(
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> JsonObject:
        pool = await _resolve_pool(request, authorization, pool_resolver, local_api_key, auth_resolver)
        return await executor_factory().models(pool=pool)

    return router


async def _resolve_pool(
    request: Request,
    authorization: str | None,
    pool_resolver: Callable[[Request, str | None], Awaitable[PoolScope]] | None,
    local_api_key: str | None,
    auth_resolver: Callable[[], str | None] | None,
) -> PoolScope:
    """Resolve the caller's PoolScope.

    When ``pool_resolver`` is set, it handles both auth and pool resolution
    (proxy key → web session → local install token).  Otherwise, the legacy
    ``_require_auth`` validates the token and the pool defaults to desktop.
    """
    if pool_resolver is not None:
        return await pool_resolver(request, authorization)
    _require_auth(authorization, local_api_key, auth_resolver)
    return PoolScope(None)


def create_litellm_gateway_router(settings: GatewaySettings) -> APIRouter | None:
    """Return the enabled gateway router; credentials stay server-side.

    The gateway is gated on ``litellm_gateway_enabled``.  Authentication uses
    the per-install token resolved at request time via
    :func:`local_auth.get_cached_local_chat_token`, so the router can be built
    during ``create_app()`` before the lifespan loads the token.
    """
    if not getattr(settings, "litellm_gateway_enabled", True):
        return None

    import asyncio
    import json

    from sqlalchemy import text

    from stitch_backend.database import get_db
    from stitch_backend.domains.ai_proxy.litellm_executor import LiteLLMExecutor
    from stitch_backend.domains.ai_proxy.local_auth import get_cached_local_chat_token
    from stitch_backend.domains.background_manager.schemas import (
        BackgroundManagerConfig,
        normalise_background_manager_config,
    )

    runtime_config = BackgroundManagerConfig.model_validate({})
    runtime_config_expires_at = 0.0
    runtime_config_lock = asyncio.Lock()

    async def load_config() -> BackgroundManagerConfig:
        nonlocal runtime_config, runtime_config_expires_at
        now = time.monotonic()
        if now < runtime_config_expires_at:
            return runtime_config

        async with runtime_config_lock:
            now = time.monotonic()
            if now < runtime_config_expires_at:
                return runtime_config
            async with get_db() as session:
                result = await session.execute(
                    text("SELECT value FROM settings WHERE key = 'background_manager_config'")
                )
                row = result.first()
            if not row or not row[0]:
                runtime_config = BackgroundManagerConfig.model_validate({})
            else:
                try:
                    value = json.loads(row[0])
                except (json.JSONDecodeError, TypeError):
                    value = None
                runtime_config = normalise_background_manager_config(value)
            runtime_config_expires_at = time.monotonic() + 1.0
            return runtime_config

    # L2 final wave: LiteLLM Router config path removed — the executor
    # routes ONLY via the AI Gateway RoutingEngine. ``load_config`` stays
    # for pipeline config sync (holone/compression).
    executor = LiteLLMExecutor(
        load_config=load_config,
    )

    async def _resolve_caller_pool(request: Request, authorization: str | None) -> PoolScope:
        """Resolve the caller's PoolScope per request.

        Order: (a) Authorization Bearer matching a user proxy key →
        PoolScope(uid, group_ids); (b) web session cookie →
        PoolScope(user.id, group_ids); (c) local install token / auth
        disabled → PoolScope(None, (), True).  Raises 401 when no auth
        path matches.
        """
        from stitch_backend.domains.ai_gateway.service import UserProxyKeyService
        from stitch_backend.domains.groups.service import group_ids_for_user

        # (a) Authorization Bearer matching a user proxy key
        raw_bearer = _extract_bearer(authorization)
        if raw_bearer:
            async with get_db() as session:
                key_svc = UserProxyKeyService(session)
                uid = await key_svc.resolve_proxy_key(raw_bearer)
                if uid is not None:
                    group_ids = await group_ids_for_user(session, uid)
                    return PoolScope(uid, tuple(group_ids))
            # (c) Local install token
            expected_token = get_cached_local_chat_token()
            if expected_token and hmac.compare_digest(
                authorization or "", f"Bearer {expected_token}",
            ):
                return PoolScope(None, (), True)

        # (b) Web session cookie
        from stitch_backend.domains.auth.router import _current_user_optional

        user, _preview, _raw = await _current_user_optional(request)
        if user is not None:
            async with get_db() as session:
                group_ids = await group_ids_for_user(session, user.id)
                return PoolScope(user.id, tuple(group_ids))

        # No auth path matched
        raise HTTPException(status_code=401, detail={"error": {"message": "Unauthorized"}})

    return create_native_gateway_router(
        lambda: executor,
        auth_resolver=get_cached_local_chat_token,
        pool_resolver=_resolve_caller_pool,
    )


def _require_auth(
    authorization: str | None,
    local_api_key: str | None,
    auth_resolver: Callable[[], str | None] | None,
) -> None:
    if auth_resolver is not None:
        expected_token = auth_resolver()
        if expected_token and hmac.compare_digest(authorization or "", f"Bearer {expected_token}"):
            return
    if local_api_key:
        expected = f"Bearer {local_api_key}"
        if hmac.compare_digest(authorization or "", expected):
            return
    raise HTTPException(status_code=401, detail={"error": {"message": "Unauthorized"}})


def _extract_bearer(authorization: str | None) -> str | None:
    """Extract the raw token from an ``Authorization: Bearer <token>`` header."""
    if not authorization:
        return None
    if not authorization.lower().startswith("bearer "):
        return None
    return authorization[7:].strip()


def _unsupported_adapter_response(payload: GatewayRequest) -> JSONResponse | None:
    if payload.provider is not None and payload.provider.lower() in _UNSUPPORTED_ADAPTERS:
        return JSONResponse(
            status_code=501,
            content={
                "error": {
                    "code": "adapter_not_implemented",
                    "message": "Provider adapter is not implemented",
                }
            },
        )
    return None


def _required_model(payload: GatewayRequest) -> str:
    if not payload.model:
        raise HTTPException(status_code=422, detail={"error": {"message": "model is required"}})
    return payload.model


def _messages(payload: GatewayRequest) -> list[dict[str, JsonValue]]:
    if payload.messages is None:
        raise HTTPException(status_code=422, detail={"error": {"message": "messages are required"}})
    return payload.messages


def _json_object(response: JsonObject | BaseModel) -> JsonObject:
    if isinstance(response, BaseModel):
        value = response.model_dump(mode="json")
        return value
    if isinstance(response, dict):
        return response
    raise HTTPException(status_code=502, detail={"error": {"message": "Invalid provider response"}})
