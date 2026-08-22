"""Admin-only command handlers for the auth domain.

These commands are registered via ``@register_command`` and dispatched
through ``POST /api/{name}``.  They are admin-only and read-only.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from sqlalchemy import func, select

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session
from stitch_backend.domains.auth import service as auth_service
from stitch_backend.domains.auth.permissions import get_matrix

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


@register_command("admin_user_overview", readonly=True, admin_only=True)
async def cmd_admin_user_overview(params: dict) -> dict:
    """Aggregate everything about a target user for an admin detail dashboard.

    Params: ``{userId: int}``.
    Returns a JSON-serializable dict with the user's profile, effective
    permissions, group memberships, plugin grants, key counts, and
    today's usage.  Returns 404 if the user is not found.

    The command is read-only and uses COUNT queries (not row loads) for
    key counts.  Secrets/tokens are never returned -- only counts.
    Domains that are not installed (open-core) are handled gracefully:
    their counts default to 0.

    Response shape::

        {
          "user": {id, username, role, telegram_id, created_at},
          "permissions": [..effective permission keys for the user's role..],
          "groups": [ {id, name, is_owner} ],
          "plugins": { "effective": [ids], "overrides": [ {pluginId, granted} ] },
          "keys": { "ai_gateway_credentials": <count>, "proxy_keys": <count>,
                    "provider_accounts": <count>, "totp": <count> },
          "usage": { "requests_today": <int>, "tokens_today": <int> }
        }
    """
    raw_uid = params.get("userId")
    try:
        user_id = int(raw_uid)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="userId must be an integer",
        ) from None

    async def _overview(db: AsyncSession) -> dict:
        # ── User ──────────────────────────────────────────────────────
        user = await auth_service.get_user(db, user_id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User not found: {user_id}",
            )

        # ── Permissions (effective for the user's role) ───────────────
        # get_matrix applies the admin hard rule (admin -> all True) and
        # merges stored overrides with defaults.  We filter for True values
        # to get the effective permission key set.
        matrix = await get_matrix(db)
        perms = sorted(
            k for k, v in matrix.get(user.role, {}).items() if v
        )

        # ── Groups ─────────────────────────────────────────────────────
        groups = await _get_groups(db, user_id, user.username)

        # ── Plugins ────────────────────────────────────────────────────
        plugins = await _get_plugins(db, user_id, user.role)

        # ── Keys (counts only -- never return secrets) ─────────────────
        keys = await _get_keys_counts(db, user_id)

        # ── Usage (best-effort; 0 if unavailable) ────────────────────
        usage = await _get_usage_today(db, user_id)

        return {
            "user": {
                "id": user.id,
                "username": user.username,
                "role": user.role,
                "telegram_id": user.telegram_id,
                "created_at": user.created_at.isoformat(),
            },
            "permissions": perms,
            "groups": groups,
            "plugins": plugins,
            "keys": keys,
            "usage": usage,
        }

    return await run_in_read_session(_overview)


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _get_groups(
    db: AsyncSession, user_id: int, username: str | None
) -> list[dict]:
    """Return the user's group memberships as ``[{id, name, is_owner}]``.

    Reuses :func:`list_groups_for_user` from the groups domain, which
    accepts an arbitrary ``uid`` (not session-bound).  Falls back to an
    empty list when the groups domain is not installed.
    """
    try:
        from stitch_backend.domains.groups.service import list_groups_for_user
    except ImportError:
        logger.debug("groups domain not installed -- returning empty list")
        return []

    data = await list_groups_for_user(db, user_id, username)
    return [
        {
            "id": g["id"],
            "name": g["name"],
            "is_owner": g.get("role") == "owner",
        }
        for g in data.get("groups", [])
    ]


async def _get_plugins(
    db: AsyncSession, user_id: int, role: str
) -> dict:
    """Return ``{"effective": [ids], "overrides": [{pluginId, granted}]}``.

    Overrides are read directly from the ``user_plugin_grants`` table
    (per-user plugin grant overrides).  The effective set is computed by
    :func:`get_effective_entitlements` which merges role grants, user
    overrides, and legacy activation entitlements.  Falls back to empty
    lists when the plugin_distribution domain is not installed.
    """
    overrides: list[dict] = []
    try:
        from stitch_backend.domains.plugin_distribution.models import (
            UserPluginGrant,
        )

        stmt = (
            select(UserPluginGrant)
            .where(UserPluginGrant.user_id == user_id)
            .order_by(UserPluginGrant.plugin_id)
        )
        result = await db.execute(stmt)
        for row in result.scalars().all():
            overrides.append(
                {
                    "pluginId": row.plugin_id,
                    "granted": row.granted,
                }
            )
    except ImportError:
        logger.debug(
            "plugin_distribution models not installed -- empty overrides"
        )

    effective: list[str] = []
    try:
        from stitch_backend.domains.plugin_distribution.entitlements import (
            get_effective_entitlements,
        )

        eff_set = await get_effective_entitlements(user_id, role)
        effective = sorted(eff_set)
    except ImportError:
        logger.debug(
            "plugin_distribution entitlements not installed -- empty effective"
        )

    return {"effective": effective, "overrides": overrides}


async def _get_keys_counts(db: AsyncSession, user_id: int) -> dict:
    """Return counts for each key/credential type owned by the user.

    Uses COUNT queries (not row loads) for cheap reads.  Each domain is
    imported lazily inside a try/except so a missing domain (open-core)
    yields a 0 count instead of an import error.
    """
    counts = {
        "ai_gateway_credentials": 0,
        "proxy_keys": 0,
        "provider_accounts": 0,
        "totp": 0,
    }

    # AI gateway credentials (owner_id column)
    try:
        from stitch_backend.domains.ai_gateway.models import Credential

        result = await db.execute(
            select(func.count())
            .select_from(Credential)
            .where(Credential.owner_id == user_id)
        )
        counts["ai_gateway_credentials"] = int(result.scalar_one())
    except ImportError:
        pass

    # AI gateway user proxy keys (user_id column)
    try:
        from stitch_backend.domains.ai_gateway.models import UserProxyKey

        result = await db.execute(
            select(func.count())
            .select_from(UserProxyKey)
            .where(UserProxyKey.user_id == user_id)
        )
        counts["proxy_keys"] = int(result.scalar_one())
    except ImportError:
        pass

    # Provider accounts -- Kiro/Windsurf/etc. (owner_id column)
    try:
        from stitch_backend.domains.accounts.models import Account

        result = await db.execute(
            select(func.count())
            .select_from(Account)
            .where(Account.owner_id == user_id)
        )
        counts["provider_accounts"] = int(result.scalar_one())
    except ImportError:
        pass

    # TOTP keys (owner_id column) — resolved via SPI so a healthy
    # stitch-totp plugin store is counted instead of the core table.
    try:
        from stitch_backend.core.spi import SPI_TOTP, resolve

        counts["totp"] = await resolve(SPI_TOTP).count_owned_keys(user_id)
    except ImportError:
        pass

    return counts


async def _get_usage_today(db: AsyncSession, user_id: int) -> dict:
    """Return today's group-usage totals for the user (best-effort).

    Queries the ``group_usage`` table (per-group, per-user, per-day
    accounting) for today's date.  Returns 0/0 when the groups domain is
    not installed or no usage rows exist.
    """
    try:
        from stitch_backend.domains.groups.models import GroupUsage
    except ImportError:
        return {"requests_today": 0, "tokens_today": 0}

    today = datetime.now(UTC).strftime("%Y-%m-%d")
    result = await db.execute(
        select(
            func.coalesce(func.sum(GroupUsage.requests), 0),
            func.coalesce(func.sum(GroupUsage.tokens), 0),
        ).where(
            GroupUsage.user_id == user_id,
            GroupUsage.day == today,
        )
    )
    row = result.one()
    return {
        "requests_today": int(row[0] or 0),
        "tokens_today": int(row[1] or 0),
    }
