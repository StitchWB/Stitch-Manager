"""Gemini web adapter — concrete ``WebSessionAdapter`` (T3).

Bridges :mod:`gemini_protocol` (pure protocol) to the OpenAI-compatible
chat gateway. Implements account rotation, anonymous fallback, streaming
SSE shaping, error classification, and cooldown marking — all with strict
secret sanitization (cookie values never leave this module unredacted).

Design decisions (from the review-approved plan):
- D1: credentials come from the ORM ``accounts`` table (``provider="web-gemini"``).
- D2: cooldown via ``cooldown_until`` column; selection uses ``enabled`` +
  ``cooldownUntil`` only (never ``status``).
- D5: cooldown marking opens its own short session via ``run_in_session``.
- D6: proxy is the global outbound path only (no per-account proxy).
- D7: satisfies ``WebSessionAdapter`` (not ``ProviderAdapter``).
"""

from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import select, update

from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError
from stitch_backend.domains.ai_proxy.account_selection import select_available_account
from stitch_backend.domains.ai_proxy.web.base import (
    ModelDict,
    parse_cookie_jar,
    sanitize_secrets,
)
from stitch_backend.domains.ai_proxy.web.gemini_protocol import (
    MODELS,
    GeminiHttpClient,
    GeminiProtocolError,
    GeminiStreamRequest,
    HttpxGeminiHttpClient,
    messages_to_prompt,
    parse_tool_calls,
    stream_generate,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Cooldown duration applied when an account fails with an auth-classified error.
_COOLDOWN_SECONDS = 300

# Models that require a cookie (mode 3 = PRO). Anonymous mode excludes these.
_PRO_MODE = 3


# ─── Account loading (D1) ────────────────────────────────────────────────────


async def load_web_gemini_accounts(session: AsyncSession) -> list[dict[str, Any]]:
    """Load web-gemini accounts from the ORM ``accounts`` table (D1).

    Maps each ORM row to an adapter dict with ``"id"``, ``"provider"``,
    ``"cookies"``, ``"enabled"``, ``"cooldownUntil"`` — the shape
    :func:`select_available_account` expects.
    """
    from stitch_backend.domains.accounts.models import Account

    stmt = (
        select(Account)
        .where(Account.provider == "web-gemini")
        .where(Account.status != "archived")
        .order_by(Account.created_at.desc())
    )
    result = await session.execute(stmt)
    rows = result.scalars().all()

    mapped: list[dict[str, Any]] = []
    for acc in rows:
        cookies = acc.cookies or ""
        cooldown_ts = 0
        if acc.cooldown_until is not None:
            try:
                cooldown_ts = int(acc.cooldown_until.timestamp())
            except (ValueError, OSError):
                cooldown_ts = 0
        mapped.append({
            "id": str(acc.id),
            "provider": acc.provider,
            "cookies": cookies,
            # Status vocabulary: active|disabled|expired|banned|pending
            # (accounts models). Only active/pending are selectable.
            "enabled": acc.status not in ("archived", "disabled", "banned", "expired"),
            "cooldownUntil": cooldown_ts,
        })
    return mapped


# ─── Adapter ─────────────────────────────────────────────────────────────────


class GeminiWebAdapter:
    """In-process Gemini web adapter implementing ``WebSessionAdapter``.

    Stateless across requests: per-call state (which account, which cookies)
    is resolved inside :meth:`stream_chat_completion` from the preloaded
    account dicts. Cooldown marking opens its own session (D5).
    """

    provider_id = "web-gemini"

    def __init__(
        self,
        *,
        accounts: list[dict[str, Any]],
        settings: dict[str, bool],
        http_client_factory: Callable[[], GeminiHttpClient] | None = None,
        clock: Callable[[], float] | None = None,
        proxy: str | None = None,
    ) -> None:
        self._accounts = accounts
        self._settings = settings
        self._http_client_factory = http_client_factory or HttpxGeminiHttpClient
        self._clock = clock or time.time
        self._proxy = proxy
        self._secrets: set[str] = set()

    # ── WebSessionAdapter surface ─────────────────────────────────────────

    async def available(self) -> bool:
        if self._accounts:
            return True
        return self._settings.get("anonymous_allowed", True)

    async def list_models(self) -> list[ModelDict]:
        # Only advertise Pro models when at least one ENABLED account exists
        # (disabled/banned/expired rows must not promise Pro routing).
        has_account = any(a.get("enabled") for a in self._accounts)
        models: list[ModelDict] = []
        for name, info in MODELS.items():
            if not has_account and info["mode"] == _PRO_MODE:
                continue
            models.append({
                "id": name,
                "provider": self.provider_id,
                "name": str(info["desc"]),
                "object": "model",
            })
        return models

    def classify_error(
        self,
        exc: BaseException,
        *,
        http_status: int | None = None,
    ) -> ClassifiedError:
        status = http_status
        if status is None:
            resp = getattr(exc, "response", None)
            if resp is not None:
                status = getattr(resp, "status_code", None)

        if status == 429:
            return ClassifiedError(category="rate_limited")
        if status in (401, 403):
            return ClassifiedError(category="auth_failed")

        # HTML / WAF block — check response text
        resp = getattr(exc, "response", None)
        text = getattr(resp, "text", "") if resp is not None else ""
        if text and text.lstrip().lower().startswith("<"):
            return ClassifiedError(category="server_error")

        if status is not None and 500 <= status < 600:
            return ClassifiedError(category="server_error")
        if isinstance(exc, GeminiProtocolError):
            return ClassifiedError(category="server_error")
        return ClassifiedError(category="transport_error")

    async def stream_chat_completion(
        self, request: dict[str, object]
    ) -> AsyncIterator[str]:
        """Stream a chat completion as OpenAI SSE delta chunk strings.

        Yields complete ``data: {...}\\n\\n`` payloads and a final
        ``data: [DONE]\\n\\n``. On auth-classified failure, marks the
        account cooldown (own session, D5) and retries with the next
        available account. Falls back to anonymous mode when allowed.
        """
        model = str(request.get("model", ""))
        messages_raw = request.get("messages", [])
        tools = request.get("tools")
        has_tools = isinstance(tools, list) and bool(tools)

        model_info = MODELS.get(model)
        if model_info is None:
            yield self._error_chunk("model_not_found", f"Unknown model: {model}")
            yield "data: [DONE]\n\n"
            return

        # Convert messages to dicts for messages_to_prompt
        if isinstance(messages_raw, list):
            messages = [
                {
                    "role": m.get("role", "user") if isinstance(m, dict) else "user",
                    "content": m.get("content", "") if isinstance(m, dict) else str(m),
                    **(
                        {"tool_calls": m["tool_calls"]}
                        if isinstance(m, dict) and m.get("tool_calls")
                        else {}
                    ),
                    **(
                        {"name": m["name"]}
                        if isinstance(m, dict) and m.get("name")
                        else {}
                    ),
                }
                for m in messages_raw
            ]
        else:
            messages = []

        prompt = messages_to_prompt(messages, tools if isinstance(tools, list) else None)

        tried: set[str] = set()
        while True:
            available = [
                a for a in self._accounts
                if str(a.get("id")) not in tried
            ]
            account = select_available_account(
                available, provider="web-gemini", now=int(self._clock())
            )

            if account is None:
                # No more accounts — try anonymous if allowed
                if self._settings.get("anonymous_allowed", True):
                    try:
                        async for chunk in self._stream_once(
                            prompt,
                            model_info,
                            cookie_str="",
                            sapisid="",
                            buffer_for_tools=has_tools,
                        ):
                            yield chunk
                        return
                    except Exception as exc:
                        classified = self.classify_error(exc)
                        yield self._error_chunk(
                            classified.category,
                            self._sanitize(str(exc)),
                        )
                        yield "data: [DONE]\n\n"
                        return
                yield self._error_chunk(
                    "no_account",
                    "No available web-gemini account and anonymous mode is disabled",
                )
                yield "data: [DONE]\n\n"
                return

            cookie_str = str(account.get("cookies", "") or "")
            cookies = parse_cookie_jar(cookie_str) if cookie_str else {}
            sapisid = str(cookies.get("SAPISID", "") or "")
            if cookie_str:
                self._secrets.add(cookie_str)
            # Individual cookie VALUES too: upstream errors may echo a bare
            # value without its "NAME=" prefix, so the whole jar string alone
            # is not enough to sanitize.
            for value in cookies.values():
                if value:
                    self._secrets.add(str(value))

            try:
                async for chunk in self._stream_once(
                    prompt,
                    model_info,
                    cookie_str=cookie_str,
                    sapisid=sapisid,
                    buffer_for_tools=has_tools,
                ):
                    yield chunk
                return  # success
            except Exception as exc:
                classified = self.classify_error(exc)
                if classified.category == "auth_failed":
                    account_id = str(account.get("id"))
                    tried.add(account_id)
                    await self._mark_cooldown(account_id)
                    logger.info(
                        "web-gemini: auth failure on account %s, trying next",
                        account_id,
                    )
                    continue
                yield self._error_chunk(
                    classified.category,
                    self._sanitize(str(exc)),
                )
                yield "data: [DONE]\n\n"
                return

    # ── Internal: single stream attempt ───────────────────────────────────

    async def _stream_once(
        self,
        prompt: str,
        model_info: dict[str, int | str],
        *,
        cookie_str: str,
        sapisid: str,
        buffer_for_tools: bool = False,
    ) -> AsyncIterator[str]:
        """Attempt one StreamGenerate call and yield OpenAI SSE chunks.

        With ``buffer_for_tools`` (tools were requested) deltas are
        accumulated silently and emitted as ONE clean content chunk plus a
        ``tool_calls`` chunk at the end — matching the reference, which
        disables true streaming when tools are present so clients never see
        raw ```tool_call markdown as assistant content.
        """
        req = GeminiStreamRequest(
            prompt=prompt,
            model_id=int(model_info["mode"]),
            think_mode=int(model_info["think"]),
            cookie_str=cookie_str,
            sapisid=sapisid,
        )

        client = self._http_client_factory()
        accumulated = ""
        async for delta in stream_generate(
            req, client, proxy=self._proxy, clock=self._clock
        ):
            accumulated += delta
            if not buffer_for_tools:
                yield self._content_chunk(delta)

        # Parse tool calls after stream completes (passthrough per plan)
        clean_text, tool_calls = parse_tool_calls(accumulated)
        if buffer_for_tools:
            if clean_text:
                yield self._content_chunk(clean_text)
            if tool_calls:
                yield self._tool_calls_chunk(tool_calls)
        elif tool_calls:
            yield self._tool_calls_chunk(tool_calls)

        yield "data: [DONE]\n\n"

    # ── Internal: SSE chunk builders ──────────────────────────────────────

    @staticmethod
    def _content_chunk(content: str) -> str:
        chunk = {"choices": [{"delta": {"content": content}}]}
        return f"data: {json.dumps(chunk)}\n\n"

    @staticmethod
    def _tool_calls_chunk(tool_calls: list[dict[str, Any]]) -> str:
        indexed = []
        for i, tc in enumerate(tool_calls):
            indexed.append({**tc, "index": i})
        chunk = {"choices": [{"delta": {"tool_calls": indexed}}]}
        return f"data: {json.dumps(chunk)}\n\n"

    def _error_chunk(self, code: str, message: str) -> str:
        chunk = {"error": {"code": code, "message": self._sanitize(message)}}
        return f"data: {json.dumps(chunk)}\n\n"

    # ── Internal: sanitization + cooldown ────────────────────────────────

    def _sanitize(self, text: str) -> str:
        return sanitize_secrets(text, self._secrets)

    async def _mark_cooldown(self, account_id: str) -> None:
        """Mark an account as cooled down via its own short session (D5)."""
        from stitch_backend.domains.accounts.models import Account

        cooldown_until = datetime.now(UTC) + timedelta(seconds=_COOLDOWN_SECONDS)

        async def _op(session: AsyncSession) -> None:
            await session.execute(
                update(Account)
                .where(Account.id == str(account_id))
                .values(cooldown_until=cooldown_until, updated_at=datetime.now(UTC))
            )

        try:
            await run_in_session(_op)
        except Exception as exc:  # noqa: BLE001 — cooldown failure is non-fatal
            logger.warning(
                "web-gemini: failed to mark cooldown for account %s: %s",
                account_id, exc,
            )
