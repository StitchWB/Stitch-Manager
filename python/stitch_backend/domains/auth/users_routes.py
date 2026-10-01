"""Admin user management: list/create users, update role, delete user."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_session
from stitch_backend.domains.auth import service as auth_service
from stitch_backend.domains.auth.helpers import (
    UserPublic,
    _user_public,
    get_current_user,
    require_role,
)
from stitch_backend.domains.auth.roles import SELECTABLE_ROLES

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from stitch_backend.domains.auth.models import User

router = APIRouter()


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    role: str = Field("user", pattern="^(" + "|".join(SELECTABLE_ROLES) + ")$")


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
        # Self-delete guard runs after last-admin so the more specific error wins.
        if current_user.id == user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete your own account",
            )
        await auth_service.delete_user(db, user_id)
        return None

    await run_in_session(_op)
    return {"success": True}
