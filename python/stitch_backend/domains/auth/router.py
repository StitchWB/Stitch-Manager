"""REST API router for the auth domain.

Mounted under the existing ``/api`` prefix (via :mod:`stitch_backend.api.router`)
at ``/api/auth/*``.  The auth subsystem is always wired up when
``auth_enabled`` is on; whether login is *required* is decided by the
middleware based on the effective ``required = auth_required OR
(has_users AND enforce_login)`` contract:

  - Fresh desktop (``auth_required=False``, no users) → NOT required →
    every ``/api/*`` request passes through without a session; the auth
    endpoints below remain functional so the user can opt in by creating
    a local account via ``/api/auth/setup``.
  - Desktop with users (opted in) and ``enforce_login=True`` (default) →
    required → 401 without session.
  - Desktop with users but ``enforce_login=False`` (admin opted out via
    ``POST /api/auth/policy``) → NOT required → unauthenticated requests
    pass through; the admin stays logged in and can flip it back on.
  - VDS (``STITCH_AUTH_REQUIRED=1``) → required from first run
    (bypasses ``enforce_login``).

When required, the middleware gates every other ``/api/*`` route; these
auth endpoints are the public exceptions:

  GET  /api/auth/status          — always public; reports enabled + has_users + required + enforce_login
  POST /api/auth/login           — sets cookie + returns user; 401 on bad creds
  POST /api/auth/setup           — creates first admin when zero users (403 otherwise)
  POST /api/auth/logout          — clears cookie, deletes session
  GET  /api/auth/me              — user object or 401
  GET  /api/auth/users (admin)   — list without hashes
  POST /api/auth/users (admin)   — create; 409 on dup
  DELETE /api/auth/users/{id} (admin) — delete (not self; not last admin)
  POST /api/auth/policy (admin)  — persist enforce_login toggle
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from stitch_backend.config import get_settings
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import get_db, run_in_session
from stitch_backend.domains.auth import service as auth_service
from stitch_backend.domains.auth.roles import SELECTABLE_ROLES

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from stitch_backend.domains.auth.models import User

logger = logging.getLogger(__name__)

#: Cookie name for the session token.
COOKIE_NAME = "stitch_session"

#: Paths that stay public even when auth is enabled (the middleware checks
#: against this set).  Kept here so the router owns the contract.
PUBLIC_PATHS: frozenset[str] = frozenset({
    "/api/auth/login",
    "/api/auth/login_telegram",
    "/api/auth/status",
    "/api/auth/setup",
})

router = APIRouter(prefix="/auth", tags=["Auth"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class UserPublic(BaseModel):
    """User object without the password hash — what every endpoint returns."""

    id: int
    username: str
    role: str
    created_at: str


class StatusResponse(BaseModel):
    enabled: bool
    has_users: bool
    required: bool
    enforce_login: bool


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    user: UserPublic


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    role: str = Field("user", pattern="^(" + "|".join(SELECTABLE_ROLES) + ")$")


class SetupRequest(BaseModel):
    """Body for POST /api/auth/setup — creates the first admin."""

    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class PolicyRequest(BaseModel):
    """Body for POST /api/auth/policy — admin-controllable login enforcement."""

    enforce_login: bool


class PolicyResponse(BaseModel):
    enforce_login: bool


# ── Helpers ───────────────────────────────────────────────────────────────────


def _user_public(user: User) -> UserPublic:
    """Build the public user object (no password hash)."""
    return UserPublic(
        id=user.id,
        username=user.username,
        role=user.role,
        created_at=user.created_at.isoformat(),
    )


def _set_session_cookie(response: Response, raw_token: str, expires_at) -> None:
    """Set the session cookie on *response*.

    ``Secure`` is set when the request scheme is https; ``SameSite=Strict``
    and ``HttpOnly`` are always on.
    """
    # The request scheme is determined by the X-Forwarded-Proto header
    # (set by the reverse proxy on the VDS) or the connection type.
    # FastAPI's Request.url.scheme reflects the upstream's scheme; we
    # trust X-Forwarded-Proto when present so the cookie is marked Secure
    # behind TLS-terminating proxies.
    secure = False
    # The actual request is read inside the endpoint (see login).
    # For the cookie helper we accept the resolved flag.
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        expires=expires_at,
        path="/",
        httponly=True,
        samesite="strict",
        secure=secure,
    )


def _resolve_raw_token(request: Request) -> str:
    """Extract the raw session token from cookie or ``Authorization: Bearer``."""
    cookie_token = request.cookies.get(COOKIE_NAME)
    if cookie_token:
        return cookie_token
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    return ""


async def _current_user_optional(request: Request) -> tuple[User | None, str]:
    """Return ``(user, raw_token)`` if a valid session is present, else ``(None, "")``.

    Opens a short-lived DB session — used by the middleware and the
    ``/me`` endpoint.  Returns ``raw_token`` so the caller can use it for
    logout without re-parsing the request.
    """
    raw_token = _resolve_raw_token(request)
    if not raw_token:
        return None, ""

    from stitch_backend.database import get_session_factory

    factory = get_session_factory()
    async with factory() as db:
        user = await auth_service.resolve_session(db, raw_token)
        # Detach so the caller can read attributes after the session closes.
        if user is not None:
            db.expunge(user)
    return user, raw_token


# ── Dependencies ──────────────────────────────────────────────────────────────


async def get_current_user(request: Request) -> User:
    """FastAPI dependency: return the authenticated user or raise 401.

    Used by endpoints that require *any* authenticated user.
    """
    user, _raw_token = await _current_user_optional(request)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return user


def require_role(role: str):
    """FastAPI dependency factory: require the authenticated user to have *role*.

    Usage::

        @router.post("/users", dependencies=[Depends(require_role("admin"))])
        async def create_user(...): ...
    """
    async def _require_role(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role != role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role: {role}",
            )
        return current_user

    return _require_role


# ── Endpoints ─────────────────────────────────────────────────────────────────


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
            enabled=False, has_users=False, required=False, enforce_login=True
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
        # When auth is off, login is a no-op — return a synthetic user so
        # the frontend can call this endpoint unconditionally.
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

    # Set cookie — Secure when the request came over https.
    secure = request.url.scheme == "https" or request.headers.get(
        "x-forwarded-proto", ""
    ).lower() == "https"
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        expires=expires_at,
        path="/",
        httponly=True,
        samesite="strict",
        secure=secure,
    )
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
        _promote_to_admin_if_needed,
        exchange_telegram_code,
    )

    code = body.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")

    try:
        user, entitlements, raw_token, expires_at, tg_admin = await exchange_telegram_code(code)
    except Exception as exc:  # noqa: BLE001 — friendly 401, same as /login
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_map_activation_error(exc),
        ) from exc

    # Promote to admin if the TG bot flagged this code as admin-issued
    # (PROMOTE ONLY — never demotes; manual demotion via Users page persists).
    user = await _promote_to_admin_if_needed(user, tg_admin)

    # Set cookie — Secure when the request came over https.
    secure = request.url.scheme == "https" or request.headers.get(
        "x-forwarded-proto", ""
    ).lower() == "https"
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        expires=expires_at,
        path="/",
        httponly=True,
        samesite="strict",
        secure=secure,
    )
    return {
        "success": True,
        "user": _user_public(user).model_dump(),
        "entitlements": entitlements,
    }


@router.post("/setup", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
async def setup(
    body: SetupRequest,
    request: Request,
    response: Response,
) -> LoginResponse:
    """Create the first admin user when zero users exist; 403 otherwise.

    This is the unauthenticated bootstrap endpoint — it's only callable when
    the user table is empty.  On success it sets a session cookie (same as
    login) so the caller is immediately authenticated as the new admin.
    """
    settings = get_settings()
    if not settings.auth_enabled:
        # Auth is off — no setup needed.  Return a synthetic user like login.
        return LoginResponse(
            user=UserPublic(id=0, username="", role="user", created_at="")
        )

    async def _op(session: AsyncSession):
        count = await auth_service.count_users(session)
        if count > 0:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Setup is only allowed when no users exist",
            )
        user = await auth_service.create_user(
            session, username=body.username, password=body.password, role="admin"
        )
        raw_token, expires_at = await auth_service.create_session(session, user.id)
        return user, raw_token, expires_at

    try:
        user, raw_token, expires_at = await run_in_session(_op)
    except StitchError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=exc.detail,
        ) from exc

    secure = request.url.scheme == "https" or request.headers.get(
        "x-forwarded-proto", ""
    ).lower() == "https"
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        expires=expires_at,
        path="/",
        httponly=True,
        samesite="strict",
        secure=secure,
    )
    return LoginResponse(user=_user_public(user))


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict[str, bool]:
    """Clear the session cookie and delete the session row."""
    settings = get_settings()
    # Always clear the cookie, even if auth is off or no session exists.
    response.delete_cookie(key=COOKIE_NAME, path="/")
    if not settings.auth_enabled:
        return {"success": True}

    raw_token = _resolve_raw_token(request)
    if raw_token:
        await run_in_session(lambda db: auth_service.delete_session(db, raw_token))
    return {"success": True}


@router.post(
    "/policy",
    response_model=PolicyResponse,
    dependencies=[Depends(require_role("admin"))],
)
async def set_policy(body: PolicyRequest) -> PolicyResponse:
    """Persist the ``enforce_login`` login-enforcement policy.  Admin-only.

    Turning ``enforce_login`` OFF does NOT invalidate the admin's session —
    the session row stays in the DB and the cookie stays valid.  The
    middleware simply stops gating ``/api/*`` (because ``required`` flips
    to ``False`` when ``auth_required`` is also ``False``), so the admin
    stays logged in and can flip it back on later.

    Non-admin → 403 (via :func:`require_role`).  Unauthenticated → 401
    (via :func:`get_current_user` inside :func:`require_role`).
    """
    result = await run_in_session(
        lambda db: auth_service.set_enforce_login(db, body.enforce_login)
    )
    return PolicyResponse(enforce_login=result)


@router.get("/me", response_model=UserPublic)
async def me(current_user: User = Depends(get_current_user)) -> UserPublic:
    """Return the currently authenticated user, or 401."""
    return _user_public(current_user)


@router.get(
    "/users",
    response_model=list[UserPublic],
    dependencies=[Depends(require_role("admin"))],
)
async def list_users() -> list[UserPublic]:
    """List all users (admin only).  Password hashes are never returned."""
    users = await run_in_session(lambda db: auth_service.list_users(db))
    return [_user_public(u) for u in users]


@router.post(
    "/users",
    response_model=UserPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role("admin"))],
)
async def create_user(body: CreateUserRequest) -> UserPublic:
    """Create a new user (admin only).  409 on duplicate username."""
    try:
        user = await run_in_session(
            lambda db: auth_service.create_user(
                db,
                username=body.username,
                password=body.password,
                role=body.role,
            )
        )
    except StitchError as exc:
        # Duplicate username → 409; other validation errors → 400.
        if "already exists" in exc.detail.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=exc.detail,
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=exc.detail,
        ) from exc
    return _user_public(user)


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
    credential.  Unlike the dispatcher command variant, this route sets
    the HttpOnly session cookie so the login survives page reloads.
    """
    from stitch_backend.domains.auth.telegram_commands import (
        _map_activation_error,
        exchange_telegram_code,
    )

    code = body.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")
    try:
        user, _entitlements, raw_token, expires_at, _tg_admin = await exchange_telegram_code(code)
    except Exception as exc:  # noqa: BLE001 — friendly 401 like /login
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_map_activation_error(exc),
        ) from exc

    secure = request.url.scheme == "https" or request.headers.get(
        "x-forwarded-proto", ""
    ).lower() == "https"
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        expires=expires_at,
        path="/",
        httponly=True,
        samesite="strict",
        secure=secure,
    )
    return {"success": True, "user": _user_public(user).model_dump()}


class UpdateRoleRequest(BaseModel):
    """Body for PUT /api/auth/users/{user_id}/role."""

    role: str


@router.put(
    "/users/{user_id}/role",
    response_model=UserPublic,
    dependencies=[Depends(require_role("admin"))],
)
async def update_user_role(user_id: int, body: UpdateRoleRequest) -> UserPublic:
    """Change a user's role/tier (admin only).

    400 on unknown role / unknown user / demoting the last admin;
    403 for non-admin callers (via :func:`require_role`).
    """
    try:
        user = await run_in_session(
            lambda db: auth_service.update_user_role(db, user_id, body.role)
        )
    except StitchError as exc:
        detail = exc.detail
        code = (
            status.HTTP_404_NOT_FOUND
            if "not found" in detail.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=code, detail=detail) from exc
    return _user_public(user)


@router.delete(
    "/users/{user_id}",
    dependencies=[Depends(require_role("admin"))],
)
async def delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    """Delete a user (admin only).

    Guards (checked in order):
      - Target must exist (404).
      - Cannot delete the last admin (400) — checked before self-delete so
        the more severe constraint wins when both apply.
      - Cannot delete yourself (400).
    """
    async def _op(db: AsyncSession):
        target = await auth_service.get_user(db, user_id)
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User not found: {user_id}",
            )
        # Last-admin guard — only fires when the target is an admin.
        if target.role == "admin":
            admin_count = await auth_service.count_admins(db)
            if admin_count <= 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot delete the last admin account",
                )
        # Self-delete guard — checked after last-admin so deleting the
        # only admin (which is necessarily self) reports the more specific
        # "last admin" error.
        if current_user.id == user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete your own account",
            )
        await auth_service.delete_user(db, user_id)
        return None

    await run_in_session(_op)
    return {"success": True}


# ── Middleware integration ─────────────────────────────────────────────────────


async def _login_required_by_policy() -> bool:
    """Return whether login is required by the has_users + enforce_login policy.

    Called only when ``auth_required`` is ``False`` (desktop), so the VDS
    path (``auth_required=True``) never hits the DB here.  Returns
    ``has_users AND enforce_login`` — a device with users can opt out of
    mandatory login when an admin has set ``enforce_login=False``.
    """
    from stitch_backend.database import get_session_factory

    factory = get_session_factory()
    async with factory() as db:
        count = await auth_service.count_users(db)
        enforce_login = await auth_service.get_enforce_login(db)
    return count > 0 and enforce_login


async def auth_middleware_dispatch(request: Request, call_next):
    """ASGI middleware: gate every ``/api/*`` request behind a valid session
    when auth is *required*.

    Effective ``required = auth_required OR (has_users AND enforce_login)``:
      - Fresh desktop (``auth_required=False``, no users) → NOT required →
        unauthenticated requests pass through; the auth endpoints
        (login/setup/me/users) remain fully functional so the user can opt
        in by creating a local account.
      - Desktop with users (opted in via setup) and ``enforce_login=True``
        (default) → required → 401 without session.
      - Desktop with users but ``enforce_login=False`` (admin opted out)
        → NOT required → unauthenticated requests pass through; the admin
        stays logged in and can flip it back on.
      - VDS (``STITCH_AUTH_REQUIRED=1``) → required from first run
        (bypasses ``enforce_login``).

    No-op when ``auth_enabled`` is off.  When required, every ``/api/*``
    request without a valid session is rejected with 401, except the public
    paths in :data:`PUBLIC_PATHS`.  ``/health`` and the root ``/`` stay
    open.  The WebSocket endpoint ``/api/events`` is also gated — the
    cookie arrives automatically on the WS handshake, so we reject the
    handshake with 401 when no valid session is present.
    """
    settings = get_settings()
    if not settings.auth_enabled:
        return await call_next(request)

    path = request.url.path

    # /health and the root are always open.
    if path == "/health" or path == "/":
        return await call_next(request)

    # Only /api/* is gated.
    if not path.startswith("/api/"):
        return await call_next(request)

    # Public auth endpoints (login/status/setup) are always reachable so
    # the bootstrap flow works even before any user exists.
    if path in PUBLIC_PATHS:
        return await call_next(request)

    # Gate only when auth is required.  When not required, pass through —
    # the auth endpoints (me/users/policy) enforce their own auth via
    # FastAPI dependencies (get_current_user / require_role).
    required = settings.auth_required or await _login_required_by_policy()
    if not required:
        return await call_next(request)

    # WebSocket handshake — /api/events.
    if path == "/api/events" and request.scope.get("type") == "websocket":
        # The cookie arrives on the WS handshake; reject before accept.
        raw_token = _resolve_raw_token(request)
        if not raw_token:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Not authenticated"},
            )
        user, _ = await _current_user_optional(request)
        if user is None:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Not authenticated"},
            )
        return await call_next(request)

    # HTTP /api/* — check session.
    user, _ = await _current_user_optional(request)
    if user is None:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Not authenticated"},
        )
    return await call_next(request)
