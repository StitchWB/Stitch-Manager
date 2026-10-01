"""Public auth entry points: status, password login, Telegram code login."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from stitch_backend.config import get_settings
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_session
from stitch_backend.domains.auth import service as auth_service
from stitch_backend.domains.auth.helpers import (
    LoginResponse,
    UserPublic,
    _set_session_cookie,
    _user_public,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


class StatusResponse(BaseModel):
    enabled: bool
    has_users: bool
    required: bool
    enforce_login: bool
    tg_auth_mode: str


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


@router.get("/status", response_model=StatusResponse)
async def get_status() -> StatusResponse:
    """Always-public: report whether auth is on, whether any users exist,
    and whether login is currently required.

    Effective ``required = auth_required OR (has_users AND enforce_login)``.
    A fresh desktop with no users and no ``STITCH_AUTH_REQUIRED`` env var
    reports ``required=False`` — the app is usable without login.  Once a
    user is created via ``/api/auth/setup``, ``has_users`` flips to ``True``
    and login becomes mandatory *unless* an admin has set
    ``enforce_login=False`` via ``POST /api/auth/policy``.  VDS deployments
    set ``STITCH_AUTH_REQUIRED=1`` to enforce login from the first run
    (bypasses the ``enforce_login`` toggle entirely).
    """
    settings = get_settings()
    if not settings.auth_enabled:
        return StatusResponse(
            enabled=False,
            has_users=False,
            required=False,
            enforce_login=True,
            tg_auth_mode=settings.tg_auth_mode,
        )
    from stitch_backend.database import get_session_factory

    factory = get_session_factory()
    async with factory() as db:
        count = await auth_service.count_users(db)
        enforce_login = await auth_service.get_enforce_login(db)
    has_users = count > 0
    required = settings.auth_required or (has_users and enforce_login)
    return StatusResponse(
        enabled=True,
        has_users=has_users,
        required=required,
        enforce_login=enforce_login,
        tg_auth_mode=settings.tg_auth_mode,
    )


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
) -> LoginResponse:
    """Authenticate and set a session cookie.  401 on bad credentials."""
    settings = get_settings()
    if not settings.auth_enabled:
        # When auth is off, login is a no-op — return a synthetic user so the frontend can call this unconditionally.
        return LoginResponse(
            user=UserPublic(id=0, username="", role="user", created_at="")
        )

    async def _op(session: AsyncSession):
        user = await auth_service.authenticate(session, body.username, body.password)
        raw_token, expires_at = await auth_service.create_session(session, user.id)
        return user, raw_token, expires_at

    try:
        user, raw_token, expires_at = await run_in_session(_op)
    except StitchError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=exc.detail,
        ) from exc

    # Set cookie — single source of truth for cookie attributes.
    _set_session_cookie(response, request, raw_token, expires_at)
    return LoginResponse(user=_user_public(user))


class TelegramLoginRequest(BaseModel):
    """Body for POST /api/auth/login_telegram."""

    code: str


@router.post("/login_telegram")
async def login_telegram(
    body: TelegramLoginRequest,
    request: Request,
    response: Response,
) -> dict:
    """Exchange a one-time Telegram-bot code for a session cookie.

    Public (listed in ``PUBLIC_PATHS``) — the one-time code IS the
    credential.  The core lives in :mod:`telegram_commands` and is shared
    with the ``login_telegram`` command (desktop dispatcher path).
    """
    from stitch_backend.domains.auth.telegram_commands import (
        _map_activation_error,
        _sync_role_and_tier,
        exchange_telegram_code,
    )

    # Symmetric with /telegram-oidc: in TG_AUTH_MODE=oidc the legacy one-time-code path is disabled.
    if get_settings().tg_auth_mode == "oidc":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Code login disabled (TG_AUTH_MODE=oidc). Use Telegram OIDC.",
        )

    code = body.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")

    try:
        user, entitlements, raw_token, expires_at, tg_admin, tier = await exchange_telegram_code(code)
    except Exception as exc:  # noqa: BLE001 — friendly 401, same as /login
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_map_activation_error(exc),
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
