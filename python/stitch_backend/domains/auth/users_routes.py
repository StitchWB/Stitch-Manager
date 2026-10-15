"""Admin user management: list/create users, update role, delete user."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.auth import service as auth_service
from stitch_backend.domains.auth.helpers import (
    UserPublic,
    _user_public,
    get_current_user,
    require_role,
)
from stitch_backend.domains.auth.roles import SELECTABLE_ROLES
from stitch_backend.domains.auth.user_delete import (
    UserDeleteBlockedError,
    UserDeleteImpact,
    delete_user_guarded,
    user_delete_impact,
)

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


@router.get(
    "/users/{user_id}/delete_impact",
    response_model=UserDeleteImpact,
    dependencies=[Depends(require_role("admin"))],
)
async def get_user_delete_impact(user_id: int) -> UserDeleteImpact:
    """Preview what deleting a user would destroy or pool (admin only).

    Returns the owned groups with member counts plus owned accounts /
    credentials / endpoints counts — the payload the FE shows in the
    confirm dialog and the 409 refusal carries.
    """
    async def _op(db: AsyncSession):
        target = await auth_service.get_user(db, user_id)
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User not found: {user_id}",
            )
        return await user_delete_impact(db, user_id)

    return await run_in_read_session(_op)


@router.delete(
    "/users/{user_id}",
    dependencies=[Depends(require_role("admin"))],
)
async def delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    transfer_to: int | None = None,
) -> dict[str, bool]:
    """Delete a user (admin only).

    Guards (checked in order):
      - Target must exist (404).
      - Cannot delete the last admin (400) — checked before self-delete so
        the more severe constraint wins when both apply.
      - Cannot delete yourself (400).
      - Without ``transfer_to``: refused (409, impact payload attached)
        when the user owns a group with other members or any accounts /
        credentials / endpoints — those would be cascade-deleted or
        SET-NULLed into the instance-shared pool.
      - With ``transfer_to``: ownership of everything the user owns moves
        to that user first, then the delete proceeds.
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
        await delete_user_guarded(db, user_id, transfer_to=transfer_to)
        return None

    try:
        await run_in_session(_op)
    except UserDeleteBlockedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": exc.detail, "impact": exc.impact.model_dump()},
        ) from exc
    except StitchError as exc:
        code = (
            status.HTTP_404_NOT_FOUND
            if "not found" in exc.detail.lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=code, detail=exc.detail) from exc
    return {"success": True}
