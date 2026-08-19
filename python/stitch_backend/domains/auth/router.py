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
  POST /api/auth/preview_role (admin) — set/clear per-session role preview
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
from stitch_backend.domains.auth.permissions import (
    PERMISSION_KEYS,
    effective_permissions,
    get_matrix,
    set_permission as set_perm,
)
from stitch_backend.domains.auth.roles import SELECTABLE_ROLES, valid_role

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
    "/api/auth/telegram-oidc",
    "/api/auth/status",
    "/api/auth/setup",
    "/api/auth/my_permissions",
})

router = APIRouter(prefix="/auth", tags=["Auth"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class UserPublic(BaseModel):
    """User object without the password hash — what every endpoint returns."""

    id: int
    username: str
    role: str
    created_at: str
    #: Per-session role preview (only populated by ``/me``).  ``None`` when
    #: no preview is active or the caller is not an admin.  Backward
    #: compatible — defaults to ``None`` so login/setup/telegram responses
    #: keep working without setting it.
    preview_role: str | None = None


class StatusResponse(BaseModel):
    enabled: bool
    has_users: bool
    required: bool
    enforce_login: bool
    tg_auth_mode: str


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    user: UserPublic


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    role: str = Field("user", pattern="^(" + "|".join(SELECTABLE_ROLES) + ")$")


class PreviewRoleRequest(BaseModel):
    """Body for POST /api/auth/preview_role — set or clear the role preview.

    ``role`` is optional/nullable.  ``null`` clears the preview.  ``'admin'``
    also clears the preview (an admin cannot preview as admin — that would
    be a no-op).  Any other value must be one of SELECTABLE_ROLES (validated
    by the pattern).  Unknown strings → 422.
    """

    role: str | None = Field(
        default=None,
        pattern="^(" + "|".join(SELECTABLE_ROLES) + ")$",
    )


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


def _user_public(user: User, preview_role: str | None = None) -> UserPublic:
    """Build the public user object (no password hash).

    ``preview_role`` is only populated by ``/me``; login/setup/telegram
    login responses call this without the argument (defaults to ``None``).
    """
    return UserPublic(
        id=user.id,
        username=user.username,
        role=user.role,
        created_at=user.created_at.isoformat(),
        preview_role=preview_role,
    )


def _set_session_cookie(
    response: Response, request: Request, raw_token: str, expires_at
) -> None:
    """Set the session cookie on *response*.

    ``Secure`` is set when the request scheme is https (or the reverse
    proxy says so via ``X-Forwarded-Proto``); ``SameSite=Lax`` and
    ``HttpOnly`` are always on.  Lax (not Strict) because users arrive
    via cross-site top-level navigations from Telegram (t.me links):
    Strict cookies are withheld on such navigations AND on reloads of
    pages reached that way, which dropped sessions on refresh.  Lax
    still withholds the cookie on cross-site POSTs, so CSRF stays
    covered.

    Single source of truth for session-cookie attributes — every login
    endpoint MUST call this helper (review finding: 4 copy-pasted
    set_cookie blocks drifted into existence and one attribute change
    required touching 5 places).
    """
    secure = request.url.scheme == "https" or request.headers.get(
        "x-forwarded-proto", ""
    ).lower() == "https"
    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_token,
        expires=expires_at,
        path="/",
        httponly=True,
        samesite="lax",
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


async def _current_user_optional(
    request: Request,
) -> tuple[User | None, str | None, str]:
    """Return ``(user, preview_role, raw_token)`` if a valid session is
    present, else ``(None, None, "")``.

    Opens a short-lived DB session — used by the middleware, the ``/me``
    endpoint, ``/my_permissions``, the command dispatcher, and
    :func:`require_role`.  Returns ``raw_token`` so the caller can use it
    for logout / preview updates without re-parsing the request.

    HARD RULE — preview sanitization lives here (single source of truth):
    ``preview_role`` is only honored when the real ``user.role == 'admin'``.
    When a non-admin session has a stale ``preview_role`` (e.g. the user
    was demoted after setting a preview), it is cleared in the DB during
    resolution and ``None`` is returned.  Every consumer thus sees
    sanitized values without each one re-checking.
    """
    raw_token = _resolve_raw_token(request)
    if not raw_token:
        return None, None, ""

    from stitch_backend.database import get_session_factory

    factory = get_session_factory()
    async with factory() as db:
        user, preview_role = await auth_service.resolve_session_with_preview(
            db, raw_token
        )
        # HARD RULE: preview only for real admins.  A non-admin session
        # with a stale preview_role gets it cleared in the DB so the
        # stale value never leaks to any consumer.
        if (
            user is not None
            and preview_role is not None
            and user.role != "admin"
        ):
            await auth_service.set_session_preview_role(db, raw_token, None)
            await db.commit()
            preview_role = None
        # Detach so the caller can read attributes after the session closes.
        if user is not None:
            db.expunge(user)
    return user, preview_role, raw_token


# ── Dependencies ──────────────────────────────────────────────────────────────


async def get_current_user(request: Request) -> User:
    """FastAPI dependency: return the authenticated user or raise 401.

    Used by endpoints that require *any* authenticated user.  Returns the
    REAL user (with the real role); callers that need the effective
    (previewed) role should use :func:`_current_user_optional` directly or
    :func:`require_role` (which compares against the effective role).
    """
    user, _preview_role, _raw_token = await _current_user_optional(request)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return user


def require_role(role: str):
    """FastAPI dependency factory: require the authenticated user's
    EFFECTIVE role to be *role*.

    The effective role is the previewed role when an admin is previewing,
    otherwise the real role.  So an admin previewing ``'user'`` gets 403
    on admin-only endpoints — that is the intended honest behavior.

    The new ``/preview_role`` endpoint must NOT use this (it checks the
    REAL role directly so an admin can exit a preview).

    Usage::

        @router.post("/users", dependencies=[Depends(require_role("admin"))])
        async def create_user(...): ...
    """
    async def _require_role(request: Request) -> User:
        user, preview_role, _raw = await _current_user_optional(request)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
            )
        effective_role = preview_role or user.role
        if effective_role != role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role: {role}",
            )
        return user

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

    # Sync role + tg_tier from the TG bot's signals (mirror — may demote
    # on next login, intended behavior).
    user = await _sync_role_and_tier(user, tg_admin, tier)

    # Set cookie — single source of truth for cookie attributes.
    _set_session_cookie(response, request, raw_token, expires_at)
    return {
        "success": True,
        "user": _user_public(user).model_dump(),
        "entitlements": entitlements,
        "tier": tier,
    }


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

    preferred_username = claims.get("preferred_username")

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

    _set_session_cookie(response, request, raw_token, expires_at)
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
async def me(request: Request) -> UserPublic:
    """Return the currently authenticated user, or 401.

    ``role`` is always the REAL stored role.  ``preview_role`` is the
    per-session role preview (NULL when no preview is active or the
    caller is not an admin).  An admin previewing ``'user'`` sees
    ``role='admin'`` and ``preview_role='user'``.
    """
    user, preview_role, _raw = await _current_user_optional(request)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return _user_public(user, preview_role)


@router.post("/preview_role")
async def set_preview_role(
    body: PreviewRoleRequest, request: Request
) -> dict[str, bool | str | None]:
    """Set or clear the per-session role preview (admin only, REAL role).

    An admin can preview the app as another role: the previewed role is
    stored on the SESSION row and becomes the EFFECTIVE role for all
    authorization decisions (permission matrix, tier gating, admin_only
    commands, admin REST endpoints), while the real role stays unchanged.

    Contract:

      - Auth disabled → 400 ``{"detail": "Auth is disabled"}``.
      - No session → 401.
      - Real (stored) user role != 'admin' → 403
        ``{"detail": "Requires role: admin"}``.
      - ``role == 'admin'`` or ``role == null`` → clears the preview
        (stores NULL).
      - Unknown role string → 422 (pydantic pattern validation).
      - Success → 200 ``{"success": true, "preview_role": <stored or null>}``.

    This endpoint checks the REAL role directly (never via
    :func:`require_role` / effective role) so an admin previewing ``'user'``
    can still exit the preview.
    """
    settings = get_settings()
    if not settings.auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Auth is disabled",
        )

    user, _preview, raw_token = await _current_user_optional(request)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    # REAL role check — never the effective (previewed) role, so an
    # admin previewing 'user' can still call this endpoint to exit.
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requires role: admin",
        )

    # 'admin' or null → clear the preview (store NULL).  An admin cannot
    # preview as admin — that would be a no-op.
    stored: str | None = None if body.role is None or body.role == "admin" else body.role

    updated = await run_in_session(
        lambda db: auth_service.set_session_preview_role(db, raw_token, stored)
    )
    if not updated:
        # Session vanished between resolution and write — treat as 401.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return {"success": True, "preview_role": stored}


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


# ── Permission matrix ─────────────────────────────────────────────────────────


class PermissionUpdateRequest(BaseModel):
    """Body for PUT /api/auth/admin/permissions."""

    role: str
    key: str
    allowed: bool


@router.get("/my_permissions")
async def my_permissions(request: Request) -> dict[str, list[str]]:
    """Return the current session user's effective permission keys.

    - Auth disabled → ALL keys (desktop single-user mode).
    - Authenticated → :func:`effective_permissions` for the EFFECTIVE role
      (previewed role when an admin is previewing, otherwise the real role).
    - Guest (auth on, no session) → effective for role ``'user'``.
    """
    settings = get_settings()
    if not settings.auth_enabled:
        return {"permissions": list(PERMISSION_KEYS)}
    user, preview_role, _ = await _current_user_optional(request)
    if user is None:
        perms = await effective_permissions("user")
    else:
        perms = await effective_permissions(preview_role or user.role)
    return {"permissions": sorted(perms)}


@router.get(
    "/admin/permissions",
    dependencies=[Depends(require_role("admin"))],
)
async def get_permissions_matrix() -> dict:
    """Return the full permission matrix (admin only)."""
    from stitch_backend.database import get_session_factory

    factory = get_session_factory()
    async with factory() as db:
        matrix = await get_matrix(db)
    return {
        "roles": list(SELECTABLE_ROLES),
        "keys": list(PERMISSION_KEYS),
        "matrix": matrix,
    }


@router.put(
    "/admin/permissions",
    dependencies=[Depends(require_role("admin"))],
)
async def set_permission_endpoint(body: PermissionUpdateRequest) -> dict[str, bool]:
    """Upsert a single (role, key, allowed) permission row (admin only).

    400 for unknown role/key or attempts to modify ``admin`` rows
    (admin is immutable — the hard rule always grants everything).
    """
    if body.role == "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin permissions are immutable",
        )
    if not valid_role(body.role):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown role: {body.role!r}",
        )
    if body.key not in PERMISSION_KEYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown permission key: {body.key!r}",
        )
    await run_in_session(
        lambda db: set_perm(db, body.role, body.key, body.allowed)
    )
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
        user, _preview, _ = await _current_user_optional(request)
        if user is None:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Not authenticated"},
            )
        return await call_next(request)

    # HTTP /api/* — check session.
    user, _preview, _ = await _current_user_optional(request)
    if user is None:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Not authenticated"},
        )
    return await call_next(request)
