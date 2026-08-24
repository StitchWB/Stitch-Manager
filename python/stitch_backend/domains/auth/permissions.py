"""Configurable role-permission matrix — service helpers + enforcement.

Permission keys are stable strings grouped by prefix:

  - ``section.*``  — UI section visibility / access
  - ``action.*``    — privileged operations

Defaults: every key is allowed for every role EXCEPT ``section.settings``
and ``section.logs`` which are admin-only.  The ``admin`` role is ALWAYS
fully allowed regardless of stored rows (hard rule).  Stored rows override
defaults; the matrix returned by :func:`get_matrix` merges the two and
applies the admin hard rule.

Enforcement (:func:`ensure_permission`) is desktop-safe: when
``STITCH_AUTH_ENABLED`` is falsy it allows unconditionally (single-trusted-
user desktop model).  When auth is on, ``admin`` callers always pass; all
others are checked against the matrix for their role.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, cast

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from stitch_backend.database import run_in_read_session
from stitch_backend.domains.auth.models import RolePermission
from stitch_backend.domains.auth.roles import SELECTABLE_ROLES

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from stitch_backend.domains.auth.models import User

logger = logging.getLogger(__name__)

# ── Permission keys (v1) ──────────────────────────────────────────────────────

#: All section-access keys.
SECTION_KEYS: tuple[str, ...] = (
    "section.autoreg",
    "section.ai_hub",
    "section.automation",
    "section.mail",
    "section.tools",
    "section.totp",
    "section.scenarios",
    "section.settings",
    "section.logs",
)

#: All action keys.
ACTION_KEYS: tuple[str, ...] = (
    "action.export_accounts",
    "action.bulk_delete",
    "action.claim",
)

#: Every permission key known to the system (exact order is the public contract).
PERMISSION_KEYS: tuple[str, ...] = SECTION_KEYS + ACTION_KEYS

#: Keys that are admin-only by default (denied for every other role).
ADMIN_ONLY_KEYS: frozenset[str] = frozenset({"section.settings", "section.logs"})


def default_allowed(role: str | None, key: str) -> bool:
    """Default permission when no stored row exists.

    All keys allowed for all roles EXCEPT ``section.settings`` and
    ``section.logs`` (admin-only).  The admin hard rule is applied
    separately in :func:`get_matrix` / :func:`effective_permissions`.
    """
    if key in ADMIN_ONLY_KEYS:
        return False
    return True


# ── Matrix read / write ───────────────────────────────────────────────────────


async def get_matrix(db: AsyncSession) -> dict[str, dict[str, bool]]:
    """Return the effective permission matrix ``role -> key -> bool``.

    Starts from defaults for every selectable role, overrides with stored
    rows, then applies the admin hard rule (admin → all True).
    """
    matrix: dict[str, dict[str, bool]] = {}
    for role in SELECTABLE_ROLES:
        matrix[role] = {key: default_allowed(role, key) for key in PERMISSION_KEYS}

    stmt = select(RolePermission)
    result = await db.execute(stmt)
    for row in result.scalars().all():
        if row.role not in matrix:
            matrix[row.role] = {}
        matrix[row.role][row.key] = row.allowed

    # Admin hard rule — admin is always fully allowed regardless of stored rows.
    matrix["admin"] = dict.fromkeys(PERMISSION_KEYS, True)
    return matrix


async def set_permission(
    db: AsyncSession, role: str, key: str, allowed: bool
) -> None:
    """Upsert a single (role, key) permission row."""
    stmt = sqlite_insert(RolePermission).values(
        role=role, key=key, allowed=allowed
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["role", "key"],
        set_={"allowed": allowed},
    )
    await db.execute(stmt)
    await db.flush()


# ── Seed ──────────────────────────────────────────────────────────────────────


async def seed_defaults(db: AsyncSession) -> None:
    """Seed default permissions.

    Idempotent: when the table is empty, seeds every (role, key) combo
    with defaults.  When the table already has rows, inserts any missing
    (role, key) combos so new keys appear after upgrades.
    """
    count_stmt = select(func.count()).select_from(RolePermission)
    count = int((await db.execute(count_stmt)).scalar_one())

    if count == 0:
        for role in SELECTABLE_ROLES:
            for key in PERMISSION_KEYS:
                db.add(
                    RolePermission(
                        role=role, key=key, allowed=default_allowed(role, key)
                    )
                )
        await db.flush()
        logger.info("Seeded %d role-permission rows", len(SELECTABLE_ROLES) * len(PERMISSION_KEYS))
        return

    # Upgrade path: insert any missing (role, key) combos with defaults.
    existing_stmt = select(RolePermission.role, RolePermission.key)
    existing = {
        (r[0], r[1]) for r in (await db.execute(existing_stmt)).all()
    }
    added = 0
    for role in SELECTABLE_ROLES:
        for key in PERMISSION_KEYS:
            if (role, key) not in existing:
                db.add(
                    RolePermission(
                        role=role, key=key, allowed=default_allowed(role, key)
                    )
                )
                added += 1
    if added:
        await db.flush()
        logger.info("Inserted %d missing role-permission rows (upgrade)", added)


# ── Effective permissions ──────────────────────────────────────────────────────


async def effective_permissions(user_or_role: User | str) -> set[str]:
    """Return the set of allowed permission keys for *user_or_role*.

    ``admin`` → all keys (hard rule).  Auth-disabled must be handled by
    the caller — do not call this when auth is off.
    """
    role = getattr(user_or_role, "role", user_or_role)
    if role == "admin":
        return set(PERMISSION_KEYS)
    matrix = await run_in_read_session(lambda db: get_matrix(db))
    # role is always a str at runtime (User.role or the raw role string);
    # getattr's static type is wider, so narrow it for the matrix lookup.
    return {k for k, v in matrix.get(cast("str", role), {}).items() if v}


# ── Enforcement ───────────────────────────────────────────────────────────────


async def _is_allowed(db: AsyncSession, role: str | None, key: str) -> bool:
    """Check a single (role, key) against stored rows, falling back to defaults."""
    if role is not None:
        stmt = select(RolePermission).where(
            RolePermission.role == role, RolePermission.key == key
        )
        row = (await db.execute(stmt)).scalar_one_or_none()
        if row is not None:
            return row.allowed
    return default_allowed(role, key)


async def ensure_permission(params: dict, key: str) -> None:
    """Raise ``HTTPException(403)`` if the caller lacks *key*.

    Desktop safety: when ``STITCH_AUTH_ENABLED`` is falsy → allow
    unconditionally.  ``admin`` callers always pass.  Otherwise the matrix
    is checked for the caller's role (``_caller_role``).
    """
    from stitch_backend.config import get_settings

    if not get_settings().auth_enabled:
        return  # desktop: everything allowed
    caller_role = params.get("_caller_role")
    if caller_role == "admin":
        return
    allowed = await run_in_read_session(
        lambda db: _is_allowed(db, caller_role, key)
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission required: {key}",
        )
