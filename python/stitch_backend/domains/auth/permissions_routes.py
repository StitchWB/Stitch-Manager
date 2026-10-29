"""Permission matrix endpoints: my_permissions + admin matrix get/put."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from stitch_backend.config import get_settings
from stitch_backend.database import run_in_session
from stitch_backend.domains.auth.helpers import _current_user_optional, require_role
from stitch_backend.domains.auth.permissions import (
    PERMISSION_KEYS,
    effective_permissions,
    get_matrix,
)
from stitch_backend.domains.auth.permissions import (
    set_permission as set_perm,
)
from stitch_backend.domains.auth.roles import SELECTABLE_ROLES, valid_role

router = APIRouter()


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
