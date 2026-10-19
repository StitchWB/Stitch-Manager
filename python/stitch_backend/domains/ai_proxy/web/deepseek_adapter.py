"""DeepSeek web adapter — concrete ``WebSessionAdapter`` (Phase 1).

Bridges the vendored protocol core (``deepseek_vendor.adapter.DeepSeekAdapter``,
sync curl_cffi + WASM PoW) to the async OpenAI-compatible gateway:

- credentials come from the ORM ``accounts`` table
  (``provider="web-deepseek"``: ``token`` = Bearer token, ``cookies`` = Cookie
  header string) — D1;
- the sync vendor stream is bridged to async via a worker thread + queue;
- account rotation with cooldown marking (``UserMutedError.mute_until``
  honored) via own short sessions — D5;
- no anonymous mode: DeepSeek web always needs an account.

The vendored module is imported LAZILY so a missing optional dependency
(curl_cffi/wasmtime) degrades the provider to "unavailable" instead of
breaking backend import.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import select, update

from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError
from stitch_backend.domains.ai_proxy.account_selection import select_available_account
from stitch_backend.domains.ai_proxy.web.base import (
    ModelDict,
    sanitize_secrets,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Fallback cooldown when the upstream gives no explicit mute deadline.
_COOLDOWN_SECONDS = 300

# Public model -> (model_type, thinking_enabled). Mirrors the reference
# model_router defaults ("default" quick mode / "expert" R1 reasoning).
MODELS: dict[str, dict[str, Any]] = {
    "deepseek-chat": {"model_type": "default", "thinking": False, "desc": "DeepSeek V3 (quick)"},
    "deepseek-reasoner": {"model_type": "expert", "thinking": True, "desc": "DeepSeek R1 (expert)"},
}


class DeepSeekProviderUnavailableError(RuntimeError):
    """Vendored deps (curl_cffi/wasmtime) missing or vendor broken."""


# ─── Lazy vendored module access ────────────────────────────────────────────

_vendor_module: Any = None
_vendor_load_failed = False


def _load_vendor_module() -> Any:
    global _vendor_module, _vendor_load_failed
    if _vendor_module is None and not _vendor_load_failed:
        try:
            from stitch_backend.domains.ai_proxy.web.deepseek_vendor import (
                adapter as _mod,
            )

            _vendor_module = _mod
        except Exception as exc:  # noqa: BLE001 — ImportError et al.
            _vendor_load_failed = True
            logger.warning("deepseek vendor unavailable: %s", exc)
    return _vendor_module


def _default_vendor_factory(
    token: str, cookies: str, proxy: str | None
) -> Any:
    mod = _load_vendor_module()
    if mod is None:
        raise DeepSeekProviderUnavailableError(
            "DeepSeek web provider unavailable: curl_cffi/wasmtime not installed"
        )
    return mod.DeepSeekAdapter(token=token, cookies=cookies, proxy=proxy)


# ─── Account loading (D1) ────────────────────────────────────────────────────


async def load_web_deepseek_accounts(session: AsyncSession) -> list[dict[str, Any]]:
    """Load web-deepseek accounts from the ORM ``accounts`` table."""
    from stitch_backend.domains.accounts.models import Account

    stmt = (
        select(Account)
        .where(Account.provider == "web-deepseek")
        .where(Account.status != "archived")
        .order_by(Account.created_at.desc())
    )
    result = await session.execute(stmt)
    rows = result.scalars().all()

    mapped: list[dict[str, Any]] = []
    for acc in rows:
        cooldown_ts = 0
        if acc.cooldown_until is not None:
            try:
                cooldown_ts = int(acc.cooldown_until.timestamp())
            except (ValueError, OSError):
                cooldown_ts = 0
        mapped.append(
            {
                "id": str(acc.id),
                "provider": acc.provider,
                "token": str(acc.token or ""),
                "cookies": str(acc.cookies or ""),
                "enabled": acc.status
                not in ("archived", "disabled", "banned", "expired"),
                "cooldownUntil": cooldown_ts,
            }
        )
    return mapped


# ─── Adapter ─────────────────────────────────────────────────────────────────


class DeepSeekWebAdapter:
    """In-process DeepSeek web adapter implementing ``WebSessionAdapter``."""

    provider_id = "web-deepseek"

    def __init__(
        self,
        *,
        accounts: list[dict[str, Any]],
        settings: dict[str, bool],
        vendor_factory: Callable[[str, str, str | None], Any] | None = None,
        clock: Callable[[], float] | None = None,
        proxy: str | None = None,
    ) -> None:
        self._accounts = accounts
        self._settings = settings
        self._vendor_factory = vendor_factory or _default_vendor_factory
        self._clock = clock or time.time
        self._proxy = proxy
        self._vendors: dict[str, Any] = {}
        self._session_ids: dict[str, str] = {}
        self._parent_ids: dict[str, int] = {}
        self._secrets: set[str] = set()

    # ── WebSessionAdapter surface ─────────────────────────────────────────

    async def available(self) -> bool:
        return any(a.get("enabled") for a in self._accounts)

    async def list_models(self) -> list[ModelDict]:
        if not any(a.get("enabled") for a in self._accounts):
            return []
        return [
            {
                "id": name,
                "provider": self.provider_id,
                "name": str(info["desc"]),
                "object": "model",
            }
            for name, info in MODELS.items()
        ]

    def classify_error(
        self,
        exc: BaseException,
        *,
        http_status: int | None = None,
    ) -> ClassifiedError:
        mod = _load_vendor_module()
        if mod is not None:
            if isinstance(exc, mod.UserMutedError):
                retry_after = None
                mute_until = getattr(exc, "mute_until", None)
                if mute_until:
                    retry_after = max(0, int(mute_until - self._clock()))
                return ClassifiedError(
                    category="rate_limited", retry_after_seconds=retry_after
                )
            if isinstance(exc, mod.RateLimitError):
                return ClassifiedError(category="rate_limited")
            if isinstance(exc, mod.WAFChallengeError):
                # WAF challenge = stale session/cookies: re-auth needed.
                return ClassifiedError(category="auth_failed")

        status = http_status
        if status is None:
            resp = getattr(exc, "response", None)
            if resp is not None:
                status = getattr(resp, "status_code", None)
        if status == 429:
            return ClassifiedError(category="rate_limited")
        if status in (401, 403):
            return ClassifiedError(category="auth_failed")
        if status is not None and 500 <= status < 600:
            return ClassifiedError(category="server_error")
        if isinstance(exc, DeepSeekProviderUnavailableError):
            return ClassifiedError(category="server_error", is_endpoint_wide=True)
        return ClassifiedError(category="transport_error")

    def stream_chat_completion(
        self, request: dict[str, object]
    ) -> AsyncIterator[str]:
        return self._stream(request)

    # ── Internals ──────────────────────────────────────────────────────────

    async def _stream(self, request: dict[str, object]) -> AsyncIterator[str]:
        model = str(request.get("model", ""))
        info = MODELS.get(model)
        if info is None:
            yield self._error_chunk("model_not_found", f"Unknown model: {model}")
            yield "data: [DONE]\n\n"
            return

        prompt = _messages_to_prompt(request.get("messages"))

        tried: set[str] = set()
        while True:
            available = [
                a for a in self._accounts if str(a.get("id")) not in tried
            ]
            account = select_available_account(
                available, provider=self.provider_id, now=int(self._clock())
            )
            if account is None:
                yield self._error_chunk(
                    "no_account", "No available web-deepseek account"
                )
                yield "data: [DONE]\n\n"
                return

            account_id = str(account.get("id"))
            token = str(account.get("token", "") or "")
            cookies = str(account.get("cookies", "") or "")
            if token:
                self._secrets.add(token)
            if cookies:
                self._secrets.add(cookies)

            try:
                vendor = self._vendors.get(account_id)
                if vendor is None:
                    vendor = self._vendor_factory(token, cookies, self._proxy)
                    self._vendors[account_id] = vendor
                session_id = self._session_ids.get(account_id)
                if session_id is None:
                    created: str = await asyncio.to_thread(vendor.create_session)
                    self._session_ids[account_id] = created
                    session_id = created

                async for item in self._stream_vendor(
                    vendor, account_id, session_id, prompt, info
                ):
                    yield item
                yield "data: [DONE]\n\n"
                return
            except Exception as exc:  # noqa: BLE001
                classified = self.classify_error(exc)
                if classified.category in ("auth_failed", "rate_limited"):
                    tried.add(account_id)
                    await self._mark_cooldown(account_id, classified)
                    # A dead session must not be reused on the next account.
                    self._session_ids.pop(account_id, None)
                    logger.info(
                        "web-deepseek: %s on account %s, trying next",
                        classified.category,
                        account_id,
                    )
                    continue
                yield self._error_chunk(
                    classified.category, self._sanitize(str(exc))
                )
                yield "data: [DONE]\n\n"
                return

    async def _stream_vendor(
        self,
        vendor: Any,
        account_id: str,
        session_id: str,
        prompt: str,
        info: dict[str, Any],
    ) -> AsyncIterator[str]:
        """Bridge the sync vendor generator to async via thread + queue."""
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()
        ready_out: dict[str, Any] = {}

        def worker() -> None:
            try:
                for item in vendor.chat_stream(
                    session_id,
                    prompt,
                    model_type=info["model_type"],
                    thinking_enabled=bool(info["thinking"]),
                    parent_message_id=self._parent_ids.get(account_id),
                    ready_out=ready_out,
                ):
                    loop.call_soon_threadsafe(queue.put_nowait, ("item", item))
                loop.call_soon_threadsafe(queue.put_nowait, ("done", None))
            except Exception as exc:  # noqa: BLE001 — re-raised async side
                loop.call_soon_threadsafe(queue.put_nowait, ("error", exc))

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        try:
            while True:
                kind, payload = await queue.get()
                if kind == "item":
                    if isinstance(payload, dict):
                        # {"__type": "thinking", "content": ...}
                        yield self._reasoning_chunk(str(payload.get("content", "")))
                    else:
                        yield self._content_chunk(str(payload))
                elif kind == "error":
                    raise payload
                else:
                    break
        finally:
            parent = ready_out.get("response_message_id")
            if isinstance(parent, int):
                self._parent_ids[account_id] = parent

    # ── SSE chunk builders ────────────────────────────────────────────────

    @staticmethod
    def _content_chunk(content: str) -> str:
        import json

        return f"data: {json.dumps({'choices': [{'delta': {'content': content}}]})}\n\n"

    @staticmethod
    def _reasoning_chunk(content: str) -> str:
        import json

        return (
            f"data: {json.dumps({'choices': [{'delta': {'reasoning_content': content}}]})}\n\n"
        )

    def _error_chunk(self, code: str, message: str) -> str:
        import json

        chunk = {"error": {"code": code, "message": self._sanitize(message)}}
        return f"data: {json.dumps(chunk)}\n\n"

    # ── Sanitization + cooldown (D5) ──────────────────────────────────────

    def _sanitize(self, text: str) -> str:
        return sanitize_secrets(text, self._secrets)

    async def _mark_cooldown(
        self, account_id: str, classified: ClassifiedError
    ) -> None:
        from stitch_backend.domains.accounts.models import Account

        seconds = (
            classified.retry_after_seconds
            if classified.retry_after_seconds
            else _COOLDOWN_SECONDS
        )
        cooldown_until = datetime.now(UTC) + timedelta(seconds=seconds)

        async def _op(session: AsyncSession) -> None:
            await session.execute(
                update(Account)
                .where(Account.id == str(account_id))
                .values(cooldown_until=cooldown_until, updated_at=datetime.now(UTC))
            )

        try:
            await run_in_session(_op)
        except Exception as exc:  # noqa: BLE001 — non-fatal
            logger.warning(
                "web-deepseek: failed to mark cooldown for %s: %s", account_id, exc
            )


# ─── Prompt shaping ──────────────────────────────────────────────────────────


def _messages_to_prompt(messages: object) -> str:
    """Simple role-tagged prompt (DeepSeek upstream takes a single prompt)."""
    if not isinstance(messages, list):
        return ""
    parts: list[str] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role", "user"))
        content = message.get("content")
        if content is None:
            content = ""
        if not isinstance(content, str):
            content = str(content)
        if role == "system":
            parts.append(f"[System]: {content}")
        elif role == "assistant":
            parts.append(f"[Assistant]: {content}")
        elif role == "tool":
            parts.append(f"[Tool result]: {content}")
        else:
            parts.append(f"[User]: {content}")
    return "\n\n".join(p for p in parts if p)
