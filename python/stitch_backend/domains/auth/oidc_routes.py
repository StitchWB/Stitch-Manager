"""Telegram OIDC login (JWKS-verified id_token → session)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from stitch_backend.config import get_settings
from stitch_backend.database import run_in_session
from stitch_backend.domains.auth import service as auth_service
from stitch_backend.domains.auth.helpers import _set_session_cookie, _user_public

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


class TelegramOIDCLoginRequest(BaseModel):
    """Body for POST /api/auth/telegram-oidc.

    ``max_length`` rejects oversized blobs at the parsing layer, before
    any JWT/crypto work (recon/DoS hardening; real id_tokens are ~1-2KB).
    """

    id_token: str | None = Field(default=None, max_length=8192)


@router.post("/telegram-oidc")
async def login_telegram_oidc(
    body: TelegramOIDCLoginRequest,
    request: Request,
    response: Response,
) -> dict:
    """Verify a Telegram-issued OIDC ``id_token`` and create a session.

    Gated behind ``TG_AUTH_MODE=oidc`` — returns 403 when in ``legacy``
    mode.  When enabled, the token is verified via JWKS (RS256) and mapped
    to a per-Telegram-id user (TG handle when available, else ``tg_<id>``).
    The session cookie is set exactly like ``/login``.

    Response contract (frozen — the frontend is built against it):

      - 200 → ``{"success": true, "user": {...}, "entitlements": []}``
      - 400 → missing/empty ``id_token``
      - 401 → any verification failure
      - 403 → ``TG_AUTH_MODE=legacy``
      - 503 → JWKS endpoint unreachable
    """
    settings = get_settings()

    if settings.tg_auth_mode != "oidc":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="OIDC login is disabled",
        )

    id_token = (body.id_token or "").strip()
    if not id_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="id_token is required",
        )

    from stitch_backend.domains.auth.telegram_commands import ensure_oidc_user
    from stitch_backend.domains.auth.tg_oidc import (
        TelegramJWKSUnavailableError,
        TelegramOIDCVerificationError,
        verify_telegram_id_token,
    )

    try:
        claims = await verify_telegram_id_token(id_token)
    except TelegramJWKSUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Telegram JWKS unavailable",
        ) from exc
    except TelegramOIDCVerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=exc.detail,
        ) from exc

    # Map to a deterministic per-TG-id user (tg_<id>).
    tg_id_raw = claims.get("id", claims.get("sub"))
    try:
        tg_id = int(tg_id_raw)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Telegram id in token",
        ) from exc

    preferred_username = (
        claims.get("preferred_username")
        or claims.get("given_name")
        or claims.get("name")
    )

    async def _op(session: AsyncSession):
        user = await ensure_oidc_user(session, tg_id, preferred_username)
        raw_token, expires_at = await auth_service.create_session(session, user.id)
        return user, raw_token, expires_at

    user, raw_token, expires_at = await run_in_session(_op)

    # Set cookie — single source of truth for cookie attributes.
    _set_session_cookie(response, request, raw_token, expires_at)
    return {
        "success": True,
        "user": _user_public(user).model_dump(),
        "entitlements": [],
    }
