"""Account lifecycle + session endpoints: setup, logout, policy, me, preview_role."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from stitch_backend.config import get_settings
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_session
from stitch_backend.domains.auth import service as auth_service
from stitch_backend.domains.auth.helpers import (
    COOKIE_NAME,
    LoginResponse,
    UserPublic,
    _current_user_optional,
    _resolve_raw_token,
    _set_session_cookie,
    _user_public,
    require_role,
)
from stitch_backend.domains.auth.roles import SELECTABLE_ROLES

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


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
    # REAL role check — never the effective (previewed) role, so an admin previewing 'user' can still exit.
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requires role: admin",
        )

    # 'admin' or null → clear the preview (store NULL); an admin cannot preview as admin (no-op).
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
