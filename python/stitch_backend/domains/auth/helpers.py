"""Shared schemas, session helpers, and auth dependencies for the auth routers."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException, Request, Response, status
from pydantic import BaseModel

from stitch_backend.domains.auth import service as auth_service

if TYPE_CHECKING:
    from stitch_backend.domains.auth.models import User

#: Cookie name for the session token.
COOKIE_NAME = "stitch_session"


class UserPublic(BaseModel):
    """User object without the password hash — what every endpoint returns."""

    id: int
    username: str
    role: str
    created_at: str
    #: Per-session role preview (only populated by ``/me``); None when inactive.
    preview_role: str | None = None


class LoginResponse(BaseModel):
    user: UserPublic


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
        # HARD RULE: preview_role is honored only for real admins; a stale non-admin preview is cleared in the DB here.
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
