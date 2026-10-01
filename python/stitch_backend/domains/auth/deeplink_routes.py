"""Telegram deep-link login proxies (app → bot → app polling)."""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from stitch_backend.config import get_settings
from stitch_backend.domains.auth.helpers import _set_session_cookie, _user_public

router = APIRouter()

_DEEPLINK_TIMEOUT = 30.0


async def _deeplink_upstream(method: str, path: str, **kwargs: Any) -> httpx.Response:
    """Call the distribution server's ``/deeplink/*`` endpoints.

    Single seam for the deep-link proxies (tests patch the httpx client).
    Raises ``httpx.HTTPError`` on transport failure — callers map it to 503.
    """
    from stitch_backend.domains.plugin_distribution.config import server_url

    async with httpx.AsyncClient(timeout=_DEEPLINK_TIMEOUT) as client:
        return await client.request(method, f"{server_url()}{path}", **kwargs)


def _upstream_detail(resp: httpx.Response, fallback: str) -> str:
    """Extract the upstream error ``detail`` for passthrough (else fallback)."""
    try:
        detail = resp.json().get("detail")
    except ValueError:
        return fallback
    return str(detail) if detail else fallback


@router.post("/deeplink/start")
async def deeplink_start() -> dict:
    """Start a deep-link login: proxy the upstream token mint.

    Public (listed in ``PUBLIC_PATHS``).  The app calls this, builds the
    ``t.me/<bot>?start=login_<token>`` URL itself, and polls
    ``/api/auth/deeplink/status`` until the bot binds a code to the token.

    Contract (frozen with stitch_server):
      - 200 → ``{"token": str, "expires_in": int}``
      - 502 → upstream non-200 (detail passed through)
      - 503 → distribution server unreachable
    """
    try:
        resp = await _deeplink_upstream("POST", "/deeplink/start")
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Deeplink service unreachable",
        ) from exc
    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_upstream_detail(resp, "Deeplink start failed"),
        )
    body = resp.json()
    return {"token": body["token"], "expires_in": body["expires_in"]}


@router.get("/deeplink/status")
async def deeplink_status(token: str) -> dict:
    """Poll the upstream deep-link token status (200 and 404 pass through).

    Contract (frozen with stitch_server):
      - 200 → ``{"status": "pending"|"ready"|"consumed"|"expired"}``
      - 404 → unknown token (detail passed through)
      - 502 → other upstream non-200
      - 503 → distribution server unreachable
    """
    try:
        resp = await _deeplink_upstream(
            "GET", "/deeplink/status", params={"token": token}
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Deeplink service unreachable",
        ) from exc
    if resp.status_code == 200:
        body: dict = resp.json()
        return body
    if resp.status_code == 404:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=_upstream_detail(resp, "Deeplink not found"),
        )
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=_upstream_detail(resp, "Deeplink status failed"),
    )


class DeeplinkLoginRequest(BaseModel):
    """Body for POST /api/auth/deeplink/login."""

    token: str = Field(..., min_length=1, max_length=128)


@router.post("/deeplink/login")
async def deeplink_login(
    body: DeeplinkLoginRequest,
    request: Request,
    response: Response,
) -> dict:
    """Exchange a deep-link token for a session cookie (auto-login).

    Public (listed in ``PUBLIC_PATHS``) — the bot binds the issued one-time
    code to the token when the user arrives via
    ``t.me/<bot>?start=login_<token>``, so the token IS the credential.
    Finishes exactly like ``/api/auth/login_telegram`` (shared core in
    :mod:`telegram_commands`).

    Contract:
      - 200 → ``{"success", "user", "entitlements", "tier"}`` + session cookie
      - 400 → ``TG_AUTH_MODE=oidc`` (code login disabled)
      - 401 → upstream 409 (already used) or 404/403 (not found / expired)
      - 429 → upstream rate limit (detail passed through)
      - 502 → other upstream non-200
      - 503 → distribution server unreachable
    """
    from stitch_backend.domains.auth.telegram_commands import (
        _sync_role_and_tier,
        exchange_telegram_deeplink,
    )

    # Symmetric with /login_telegram: in TG_AUTH_MODE=oidc the legacy code/deeplink path is disabled.
    if get_settings().tg_auth_mode == "oidc":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Code login disabled (TG_AUTH_MODE=oidc). Use Telegram OIDC.",
        )

    token = body.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token is required")

    try:
        user, entitlements, raw_token, expires_at, tg_admin, tier = (
            await exchange_telegram_deeplink(token)
        )
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        if code == 409:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Deeplink already used",
            ) from exc
        if code in (403, 404):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Deeplink not found or expired",
            ) from exc
        if code == 429:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=_upstream_detail(exc.response, "Too many requests"),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_upstream_detail(exc.response, "Deeplink exchange failed"),
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Deeplink service unreachable",
        ) from exc

    # Sync role + tg_tier from the TG bot's signals (mirror — may demote on next login, intended behavior).
    user = await _sync_role_and_tier(user, tg_admin, tier)

    # Set cookie — single source of truth for cookie attributes.
    _set_session_cookie(response, request, raw_token, expires_at)
    return {
        "success": True,
        "user": _user_public(user).model_dump(),
        "entitlements": entitlements,
        "tier": tier,
    }
