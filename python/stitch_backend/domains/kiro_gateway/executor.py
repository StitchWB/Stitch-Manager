"""KiroExecutor — request pipeline orchestration for the Kiro gateway.

Implements the NativeGatewayExecutor Protocol (chat / messages / responses / models).
Pipeline: session hint → affinity → pool.get_next_account → translate inbound →
upstream call → translate outbound → stats + pool.record_success.
"""

from __future__ import annotations

import json
import logging
import time
import types
from collections.abc import AsyncGenerator, Callable
from typing import TYPE_CHECKING

import httpx
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from starlette.responses import Response

from stitch_backend.domains.ai_proxy.litellm_gateway import GatewayRequest, JsonObject
from stitch_backend.domains.kiro_gateway.pool import (
    AccountPool, AccountSnapshot, ErrorType, classify_error,
)
from stitch_backend.domains.kiro_gateway.session import (
    SessionAffinityStore, extract_session_hint,
)
from stitch_backend.domains.kiro_gateway.stats import ProxyStats

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from stitch_backend.domains.kiro_gateway.service import KiroGatewayService

logger = logging.getLogger(__name__)

# ponytail: single namespace for affinity since the shared factory consumes
# the Authorization header. Add per-api-key namespacing if the factory
# is extended to forward the key-id.
_AFFINITY_NS = "default"
_INVALID_RESP = {"error": {"message": "Invalid upstream response"}}


def _adapt_account(snap: AccountSnapshot) -> types.SimpleNamespace:
    """Adapt AccountSnapshot to the AccountLike protocol for upstream/client.py."""
    return types.SimpleNamespace(
        id=snap.id, accessToken=snap.access_token,
        refreshToken=snap.refresh_token, machineId=snap.machine_id,
        region=None, profileArn=snap.profile_arn,
        provider="kiro", authMethod=None, proxyUrl=None,
    )


class KiroExecutor:
    """Orchestrates Kiro upstream requests through the account pool."""

    def __init__(
        self,
        pool: AccountPool,
        session_factory: Callable[[], AsyncSession],
        affinity: SessionAffinityStore,
        stats: ProxyStats,
        http_client: httpx.AsyncClient,
    ) -> None:
        self._pool = pool
        self._session_factory = session_factory
        self._affinity = affinity
        self._stats = stats
        self._http = http_client
        # ponytail: per-call proxy support — cache proxy client to avoid
        # recreating on every request, but allow dynamic proxy changes.
        self._cached_proxy: str | None = None
        self._cached_proxy_client: httpx.AsyncClient | None = None

    def _get_http_client(self) -> httpx.AsyncClient:
        """Return httpx client with current outbound proxy (per-call read).
        
        Reads proxy from kiro_patch config on each call. If proxy changed,
        recreates the cached proxy client. Returns proxy client if proxy
        is configured, otherwise returns the shared no-proxy client.
        """
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
        
        current_proxy = _get_outbound_proxy()
        
        # If proxy changed, recreate the proxy client
        if current_proxy != self._cached_proxy:
            # Close old proxy client if exists
            if self._cached_proxy_client is not None:
                # Fire-and-forget close (async close in sync method)
                import asyncio
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        loop.create_task(self._cached_proxy_client.aclose())
                    else:
                        loop.run_until_complete(self._cached_proxy_client.aclose())
                except Exception:
                    pass  # Best-effort close
            
            # Create new proxy client if proxy is configured
            if current_proxy is not None:
                self._cached_proxy_client = httpx.AsyncClient(
                    timeout=httpx.Timeout(120.0, connect=10.0),
                    proxy=current_proxy,
                )
                # ponytail: mask credentials in logs
                proxy_display = current_proxy.split("@")[-1] if "@" in current_proxy else current_proxy
                logger.info("Created new proxy client for %s", proxy_display)
            else:
                self._cached_proxy_client = None
            
            self._cached_proxy = current_proxy
        
        # Return proxy client if available, otherwise shared no-proxy client
        return self._cached_proxy_client if self._cached_proxy_client is not None else self._http

    # ── Protocol methods ────────────────────────────────────────────────────

    async def chat(self, payload: GatewayRequest) -> JsonObject | Response:
        return await self._execute(payload.sdk_payload(), "chat", payload.stream)

    async def messages(self, payload: GatewayRequest) -> JsonObject | Response:
        return await self._execute(payload.sdk_payload(), "messages", payload.stream)

    async def responses(self, payload: GatewayRequest) -> JsonObject:
        body = payload.sdk_payload()
        result = await self._execute(body, "responses", payload.stream)
        if isinstance(result, Response):
            raise HTTPException(status_code=502, detail=_INVALID_RESP)
        return result

    async def models(self) -> JsonObject:
        return {
            "object": "list",
            "data": [
                {"id": m, "object": "model", "owned_by": "kiro"}
                for m in (
                    "claude-sonnet-4.5", "claude-haiku-4.5",
                    "claude-opus-4.5", "claude-sonnet-4",
                )
            ],
        }

    # ── Service helper ──────────────────────────────────────────────────────

    async def _make_svc(self) -> KiroGatewayService:
        from stitch_backend.domains.kiro_gateway.service import KiroGatewayService

        return KiroGatewayService(self._session_factory(), self._pool)

    # ── Pipeline ────────────────────────────────────────────────────────────

    async def _execute(
        self, body: JsonObject, endpoint: str, stream: bool,
    ) -> JsonObject | Response:
        from stitch_backend.domains.kiro_gateway.upstream.client import (
            KiroApiError, KiroStreamResult, SuspendedError, call_kiro_api,
        )

        # 1. Session hint → affinity
        sh = extract_session_hint({}, body)
        sticky_id = self._affinity.get(sh, _AFFINITY_NS) if sh else None

        # 2. Account selection loop (one DB session per request)
        exclude_ids: set[str] = set()
        attempt = 0
        last_error: Exception | None = None

        while True:
            max_attempts = max(1, self._pool.size)
            if attempt >= max_attempts:
                break
            account = self._pool.get_next_account(
                exclude_ids=exclude_ids if exclude_ids else None,
            )
            if account is None:
                if attempt == 0:
                    svc = await self._make_svc()
                    try:
                        await svc.load_accounts()
                    finally:
                        await svc.shutdown(commit=False)
                    account = self._pool.get_next_account()
                if account is None:
                    raise HTTPException(
                        status_code=503,
                        detail={"error": {"message": "No Kiro accounts available"}},
                    )

            attempt += 1

            # 3. Sticky affinity override (first attempt only)
            if sticky_id is not None and attempt == 1:
                sticky = self._pool.get_account(sticky_id)
                if sticky is not None and not self._pool.is_suspended(sticky):
                    account = sticky

            # 4. Token refresh
            account = await self._refresh_token(account)

            # 4. Translate inbound
            kiro_payload = self._translate(body, endpoint)
            adapter = _adapt_account(account)

            try:
                # 5. Upstream call
                if stream:
                    return await self._stream(adapter, kiro_payload, account, sh)
                result: KiroStreamResult = await call_kiro_api(
                    adapter, kiro_payload, client=self._get_http_client(),
                )
                return self._success(result, account, sh, endpoint, body)

            except SuspendedError:
                self._pool.mark_suspended(account.id, "TEMPORARILY_SUSPENDED")
                svc = await self._make_svc()
                commit = False
                try:
                    await svc.persist_suspension(account.id)
                    commit = True
                finally:
                    await svc.shutdown(commit=commit)
                exclude_ids.add(account.id)
                sticky_id = None
                if sh:
                    self._affinity.remove(sh, _AFFINITY_NS)
                self._stats.record_request(success=False)
                continue

            except KiroApiError as e:
                sc = getattr(e, "status_code", 500)
                if classify_error(sc, str(e)) == ErrorType.FATAL:
                    self._stats.record_request(success=False)
                    raise HTTPException(
                        status_code=502,
                        detail={"error": {"message": f"Kiro upstream error: {e}"}},
                    ) from e
                self._pool.record_error(account.id, ErrorType.RECOVERABLE, sc)
                exclude_ids.add(account.id)
                sticky_id = None
                last_error = e
                self._stats.record_request(success=False)
                continue

            except httpx.HTTPError as e:
                self._pool.record_error(account.id, ErrorType.RECOVERABLE)
                exclude_ids.add(account.id)
                last_error = e
                self._stats.record_request(success=False)
                continue

        self._stats.record_request(success=False)
        raise HTTPException(
            status_code=502,
            detail={"error": {"message": f"All accounts exhausted: {last_error}"}},
        )

    # ── Token refresh ───────────────────────────────────────────────────────

    async def _refresh_token(self, account: AccountSnapshot) -> AccountSnapshot:
        if not account.expires_at or account.expires_at <= 0:
            return account
        now_ms = time.time() * 1000
        if account.expires_at - now_ms >= 60_000 or not account.refresh_token:
            return account
        svc = await self._make_svc()
        commit = False
        try:
            r = await svc.refresh_token(account.id)
            if r.get("success") and r.get("refreshed"):
                # refresh_kiro_token persists tokens to the DB but never returns
                # the raw access token — re-read the row and update the pool.
                fresh = await svc.get_snapshot(account.id)
                if fresh is not None:
                    self._pool.add_account(fresh)
                    commit = True
                    return fresh
                logger.warning("Refresh succeeded but account %s unreadable", account.id)
            elif not r.get("success"):
                logger.warning(
                    "Token refresh failed for %s: %s", account.id, r.get("error"),
                )
                self._pool.record_error(account.id, ErrorType.RECOVERABLE)
                commit = True  # persist status=expired + error state from the service
        except Exception:
            logger.warning("Token refresh failed for %s", account.id, exc_info=True)
        finally:
            await svc.shutdown(commit=commit)
        return account

    # ── Stream ──────────────────────────────────────────────────────────────

    async def _stream(
        self, adapter: object, payload: JsonObject,
        account: AccountSnapshot, session_hint: str | None,
    ) -> StreamingResponse:
        from stitch_backend.domains.kiro_gateway.upstream.client import (
            call_kiro_api_stream,
        )

        async def gen() -> AsyncGenerator[str, None]:
            completed = False
            try:
                async for event in call_kiro_api_stream(
                    adapter, payload, client=self._get_http_client(),
                ):
                    chunk = json.dumps(event, separators=(",", ":"))
                    yield f"data: {chunk}\n\n"
                yield "data: [DONE]\n\n"
                completed = True
            finally:
                if completed:
                    self._pool.record_success(account.id)
                    self._stats.record_request(success=True)
                    if session_hint:
                        self._affinity.set(session_hint, account.id, _AFFINITY_NS)
                else:
                    self._pool.record_error(account.id, ErrorType.RECOVERABLE)
                    self._stats.record_request(success=False)

        return StreamingResponse(gen(), media_type="text/event-stream")

    # ── Success path ────────────────────────────────────────────────────────

    def _success(
        self, result: object, account: AccountSnapshot,
        session_hint: str | None, endpoint: str, body: JsonObject,
    ) -> JsonObject:
        from stitch_backend.domains.kiro_gateway.upstream.client import KiroStreamResult

        if not isinstance(result, KiroStreamResult):
            raise HTTPException(status_code=502, detail=_INVALID_RESP)

        response = self._build_response(result, endpoint, body)

        self._pool.record_success(account.id)
        self._stats.record_request(success=True)
        if session_hint:
            self._affinity.set(session_hint, account.id, _AFFINITY_NS)

        u = result.usage
        self._stats.record_tokens(
            input_tokens=u.get("inputTokens", 0),
            output_tokens=u.get("outputTokens", 0),
            cache_read=u.get("cacheReadTokens", 0),
            cache_write=u.get("cacheWriteTokens", 0),
            reasoning=u.get("reasoningTokens", 0),
            credits=u.get("credits", 0.0),
            model=body.get("model", ""),
        )
        return response

    # ── Translators (delegated to pipeline.py) ─────────────────────────────

    def _build_response(
        self, result: object, endpoint: str, body: JsonObject,
    ) -> JsonObject:
        from stitch_backend.domains.kiro_gateway.pipeline import build_client_response

        return build_client_response(result, endpoint, body)

    def _translate(self, body: JsonObject, endpoint: str) -> JsonObject:
        from stitch_backend.domains.kiro_gateway.pipeline import translate_inbound

        return translate_inbound(body, endpoint)