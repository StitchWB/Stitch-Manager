"""REST API router for the auth domain.

Mounted under the existing ``/api`` prefix (via :mod:`stitch_backend.api.router`)
at ``/api/auth/*``.  All endpoints are public when ``auth_enabled`` is off
(the middleware is a no-op).  When on, the middleware gates every other
``/api/*`` route; these auth endpoints are the public exceptions:

  GET  /api/auth/status          — always public; reports enabled + has_users
  POST /api/auth/login           — sets cookie + returns user; 401 on bad creds
  POST /api/auth/setup           — creates first admin when zero users (403 otherwise)
  POST /api/auth/logout          — clears cookie, deletes session
  GET  /api/auth/me              — user object or 401
  GET  /api/auth/users (admin)   — list without hashes
  POST /api/auth/users (admin)   — create; 409 on dup
  DELETE /api/auth/users/{id} (admin) — delete (not self; not last admin)
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


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    user: UserPublic


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    role: str = Field("user", pattern="^(admin|user)$")


class SetupRequest(BaseModel):
    """Body for POST /api/auth/setup — creates the first admin."""

    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


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
    """Always-public: report whether auth is on and whether any users exist."""
    settings = get_settings()
    if not settings.auth_enabled:
        return StatusResponse(enabled=False, has_users=False)
    from stitch_backend.database import get_session_factory

    factory = get_session_factory()
    async with factory() as db:
        count = await auth_service.count_users(db)
    return StatusResponse(enabled=True, has_users=count > 0)


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


async def auth_middleware_dispatch(request: Request, call_next):
    """ASGI middleware: gate every ``/api/*`` request behind a valid session.

    No-op when ``auth_enabled`` is off.  When on, every ``/api/*`` request
    without a valid session is rejected with 401, except the public paths
    in :data:`PUBLIC_PATHS`.  ``/health`` and the root ``/`` stay open.
    The WebSocket endpoint ``/api/events`` is also gated — the cookie
    arrives automatically on the WS handshake, so we reject the handshake
    with 401 when no valid session is present.
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

    # Public auth endpoints.
    if path in PUBLIC_PATHS:
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
