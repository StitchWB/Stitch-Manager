"""Admin grant commands — role/user plugin entitlement management.

Registered via ``@register_command(admin_only=True)`` so the dispatcher
rejects non-admin callers with 403 when auth is enabled.  Desktop
(auth-disabled) callers are treated as admin by the dispatcher.

Commands:
  - ``plugin_grants_role_list``    — all role grants + marketplace plugins
  - ``plugin_grants_role_set``    — upsert/delete a role grant
  - ``plugin_grants_user_get``    — user overrides + effective set
  - ``plugin_grants_user_set``    — upsert a user override
  - ``plugin_grants_user_delete`` — remove a user override
  - ``plugin_grants_group_list``  — all group grants + group names + plugins
  - ``plugin_grants_group_set``   — upsert/delete a group grant
  - ``plugin_grants_audit_list``  — newest audit entries
  - ``plugin_grants_seed_from_env``— idempotent seed from env var

Role names are validated against :mod:`stitch_backend.domains.auth.roles`
(the existing role ladder) — no hardcoded role list.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.auth.roles import valid_role

from .activation import ActivationService
from .entitlements import (
    get_effective_entitlements,
    invalidate_entitlements_cache,
)
from .models import (
    GroupPluginGrant,
    PluginGrantAudit,
    RolePluginGrant,
    UserPluginGrant,
)
from .sync import PluginSyncService

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(UTC)


async def _fetch_manifest_plugins() -> list[dict[str, str]]:
    """Fetch the official manifest and return ``[{id, name, version}]``.

    Returns an empty list when not activated, server unreachable, or any
    error — never raises.
    """
    try:
        activation = ActivationService()
        state = activation.load()
        if state is None or state.degraded:
            return []
        async with httpx.AsyncClient(timeout=30.0) as client:
            sync = PluginSyncService(activation, client=client)
            manifest = await sync.fetch_manifest(state.token)
        plugins: list[dict[str, str]] = []
        for entry in manifest.get("plugins", []):
            pid = str(entry.get("id", ""))
            if not pid:
                continue
            plugins.append(
                {
                    "id": pid,
                    "name": str(entry.get("name", pid)),
                    "version": str(entry.get("version", "")),
                }
            )
        return plugins
    except Exception as exc:  # noqa: BLE001 — graceful
        logger.warning("grant_commands: manifest fetch failed: %s", exc)
        return []


# ── Role grants ───────────────────────────────────────────────────────────────


@register_command("plugin_grants_role_list", readonly=True, admin_only=True)
async def cmd_plugin_grants_role_list(params: dict) -> dict:
    """List all role grants + marketplace plugins.

    Returns ``{"roles": {role: [plugin_id,...]}, "plugins": [...]}``.
    Plugins come from the marketplace manifest fetch; empty when
    unavailable.
    """
    async def _fetch(session: Any) -> dict[str, list[str]]:
        stmt = select(RolePluginGrant).order_by(
            RolePluginGrant.role, RolePluginGrant.plugin_id
        )
        result = await session.execute(stmt)
        roles: dict[str, list[str]] = {}
        for row in result.scalars().all():
            roles.setdefault(row.role, []).append(row.plugin_id)
        return roles

    roles = await run_in_read_session(_fetch)
    plugins = await _fetch_manifest_plugins()
    return {"roles": roles, "plugins": plugins}


@register_command("plugin_grants_role_set", admin_only=True)
async def cmd_plugin_grants_role_set(params: dict) -> dict:
    """Upsert (granted=True) or delete (granted=False) a role grant.

    Params: ``{role, pluginId, granted}``.
    """
    role = str(params.get("role", ""))
    plugin_id = str(params.get("pluginId", ""))
    granted = bool(params.get("granted", False))
    admin_id = params.get("_caller_user_id")

    if not role or not plugin_id:
        return {"success": False, "error": "role and pluginId required"}
    if not valid_role(role):
        return {"success": False, "error": f"unknown role: {role}"}

    now = _utcnow()
    action = "grant" if granted else "revoke"

    async def _do(session: Any) -> dict:
        if granted:
            stmt = sqlite_insert(RolePluginGrant).values(
                role=role,
                plugin_id=plugin_id,
                updated_at=now,
                updated_by=admin_id,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["role", "plugin_id"],
                set_={"updated_at": now, "updated_by": admin_id},
            )
            await session.execute(stmt)
        else:
            await session.execute(
                delete(RolePluginGrant).where(
                    RolePluginGrant.role == role,
                    RolePluginGrant.plugin_id == plugin_id,
                )
            )
        session.add(
            PluginGrantAudit(
                ts=now,
                admin_user_id=admin_id,
                action=action,
                scope="role",
                target=role,
                plugin_id=plugin_id,
                granted=None,
            )
        )
        await session.flush()
        return {"success": True}

    result = await run_in_session(_do)
    invalidate_entitlements_cache(role=role)
    return result


# ── User grants ───────────────────────────────────────────────────────────────


@register_command("plugin_grants_user_get", readonly=True, admin_only=True)
async def cmd_plugin_grants_user_get(params: dict) -> dict:
    """List a user's overrides + their effective entitlement set.

    Params: ``{userId}``.
    Returns ``{"grants": [{"pluginId","granted"}], "effective": [...]}``.
    """
    raw_uid = params.get("userId")
    try:
        user_id = int(raw_uid)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return {"success": False, "error": "userId must be an integer"}

    async def _fetch(session: Any) -> dict:
        stmt = select(UserPluginGrant).where(UserPluginGrant.user_id == user_id)
        result = await session.execute(stmt)
        grants = [
            {"pluginId": row.plugin_id, "granted": row.granted}
            for row in result.scalars().all()
        ]
        return {"grants": grants}

    data = await run_in_read_session(_fetch)

    # Effective set needs the user's role — read it from auth_users.
    role = await _get_user_role(user_id)
    effective = await get_effective_entitlements(user_id, role)
    data["effective"] = sorted(effective)
    return data


@register_command("plugin_grants_user_set", admin_only=True)
async def cmd_plugin_grants_user_set(params: dict) -> dict:
    """Upsert a per-user override (granted=True adds, False revokes).

    Params: ``{userId, pluginId, granted}``.
    """
    raw_uid = params.get("userId")
    try:
        user_id = int(raw_uid)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return {"success": False, "error": "userId must be an integer"}
    plugin_id = str(params.get("pluginId", ""))
    granted = bool(params.get("granted", False))
    admin_id = params.get("_caller_user_id")

    if not plugin_id:
        return {"success": False, "error": "pluginId required"}

    now = _utcnow()
    action = "grant" if granted else "revoke"

    async def _do(session: Any) -> dict:
        stmt = sqlite_insert(UserPluginGrant).values(
            user_id=user_id,
            plugin_id=plugin_id,
            granted=granted,
            updated_at=now,
            updated_by=admin_id,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["user_id", "plugin_id"],
            set_={
                "granted": granted,
                "updated_at": now,
                "updated_by": admin_id,
            },
        )
        await session.execute(stmt)
        session.add(
            PluginGrantAudit(
                ts=now,
                admin_user_id=admin_id,
                action=action,
                scope="user",
                target=str(user_id),
                plugin_id=plugin_id,
                granted=granted,
            )
        )
        await session.flush()
        return {"success": True}

    result = await run_in_session(_do)
    invalidate_entitlements_cache(user_id=user_id)
    return result


@register_command("plugin_grants_user_delete", admin_only=True)
async def cmd_plugin_grants_user_delete(params: dict) -> dict:
    """Remove a per-user override row.

    Params: ``{userId, pluginId}``.
    """
    raw_uid = params.get("userId")
    try:
        user_id = int(raw_uid)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return {"success": False, "error": "userId must be an integer"}
    plugin_id = str(params.get("pluginId", ""))
    admin_id = params.get("_caller_user_id")

    if not plugin_id:
        return {"success": False, "error": "pluginId required"}

    now = _utcnow()

    async def _do(session: Any) -> dict:
        await session.execute(
            delete(UserPluginGrant).where(
                UserPluginGrant.user_id == user_id,
                UserPluginGrant.plugin_id == plugin_id,
            )
        )
        session.add(
            PluginGrantAudit(
                ts=now,
                admin_user_id=admin_id,
                action="revoke",
                scope="user",
                target=str(user_id),
                plugin_id=plugin_id,
                granted=None,
            )
        )
        await session.flush()
        return {"success": True}

    result = await run_in_session(_do)
    invalidate_entitlements_cache(user_id=user_id)
    return result


# ── Group grants ─────────────────────────────────────────────────────────────


@register_command("plugin_grants_group_list", readonly=True, admin_only=True)
async def cmd_plugin_grants_group_list(params: dict) -> dict:
    """List all group grants + group names + marketplace plugins.

    Returns ``{"groups": {group_id: [plugin_id,...]},
    "groupNames": {group_id: name}, "plugins": [...]}``.  Plugins come from
    the marketplace manifest fetch; empty when unavailable.
    """
    from stitch_backend.domains.groups.models import Group

    async def _fetch(session: Any) -> dict:
        grant_stmt = select(GroupPluginGrant).order_by(
            GroupPluginGrant.group_id, GroupPluginGrant.plugin_id
        )
        grant_result = await session.execute(grant_stmt)
        groups: dict[str, list[str]] = {}
        for row in grant_result.scalars().all():
            groups.setdefault(row.group_id, []).append(row.plugin_id)

        name_stmt = select(Group.id, Group.name)
        name_result = await session.execute(name_stmt)
        names = {str(r[0]): str(r[1]) for r in name_result.all()}
        return {"groups": groups, "groupNames": names}

    data = await run_in_read_session(_fetch)
    data["plugins"] = await _fetch_manifest_plugins()
    return data


@register_command("plugin_grants_group_set", admin_only=True)
async def cmd_plugin_grants_group_set(params: dict) -> dict:
    """Upsert (granted=True) or delete (granted=False) a group grant.

    Every member of the group gains (granted=True) or loses (granted=False)
    the plugin.  Params: ``{groupId, pluginId, granted}``.
    """
    group_id = str(params.get("groupId", ""))
    plugin_id = str(params.get("pluginId", ""))
    granted = bool(params.get("granted", False))
    admin_id = params.get("_caller_user_id")

    if not group_id or not plugin_id:
        return {"success": False, "error": "groupId and pluginId required"}

    now = _utcnow()
    action = "grant" if granted else "revoke"

    async def _do(session: Any) -> dict:
        if granted:
            stmt = sqlite_insert(GroupPluginGrant).values(
                group_id=group_id,
                plugin_id=plugin_id,
                updated_at=now,
                updated_by=admin_id,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["group_id", "plugin_id"],
                set_={"updated_at": now, "updated_by": admin_id},
            )
            await session.execute(stmt)
        else:
            await session.execute(
                delete(GroupPluginGrant).where(
                    GroupPluginGrant.group_id == group_id,
                    GroupPluginGrant.plugin_id == plugin_id,
                )
            )
        session.add(
            PluginGrantAudit(
                ts=now,
                admin_user_id=admin_id,
                action=action,
                scope="group",
                target=group_id,
                plugin_id=plugin_id,
                granted=None,
            )
        )
        await session.flush()
        return {"success": True}

    result = await run_in_session(_do)
    # A group grant change affects every member — drop the whole cache
    # (keyed by (user_id, role); targeted invalidation would need the member
    # list, so a full clear is the simple correct option at 60s TTL).
    invalidate_entitlements_cache()
    return result


# ── Audit ─────────────────────────────────────────────────────────────────────


@register_command("plugin_grants_audit_list", readonly=True, admin_only=True)
async def cmd_plugin_grants_audit_list(params: dict) -> dict:
    """List the newest audit entries.

    Params: ``{limit?}`` (default 100).
    Returns ``{"entries": [{id, ts, adminUserId, action, scope, target,
    pluginId, granted}]}``.
    """
    limit = params.get("limit", 100)
    try:
        limit_int = max(1, min(int(limit), 500))
    except (TypeError, ValueError):
        limit_int = 100

    async def _fetch(session: Any) -> list[dict]:
        stmt = (
            select(PluginGrantAudit)
            .order_by(PluginGrantAudit.id.desc())
            .limit(limit_int)
        )
        result = await session.execute(stmt)
        return [
            {
                "id": row.id,
                "ts": row.ts.isoformat() if row.ts else None,
                "adminUserId": row.admin_user_id,
                "action": row.action,
                "scope": row.scope,
                "target": row.target,
                "pluginId": row.plugin_id,
                "granted": row.granted,
            }
            for row in result.scalars().all()
        ]

    entries = await run_in_read_session(_fetch)
    return {"entries": entries}


# ── Seed from env ─────────────────────────────────────────────────────────────


@register_command("plugin_grants_seed_from_env", admin_only=True)
async def cmd_plugin_grants_seed_from_env(params: dict) -> dict:
    """Idempotently seed role grants from ``STITCH_SERVER_TIER_ENTITLEMENTS``.

    Env format: ``"user=a,b;premium=*;elite=kiro-autoreg"``.
    If the table is non-empty → ``{"success": false, "reason": "already seeded"}``.
    """
    admin_id = params.get("_caller_user_id")

    async def _count(session: Any) -> int:
        stmt = select(func.count()).select_from(RolePluginGrant)
        result = await session.execute(stmt)
        return int(result.scalar_one())

    count = await run_in_read_session(_count)
    if count > 0:
        return {"success": False, "reason": "already seeded"}

    raw_env = os.environ.get("STITCH_SERVER_TIER_ENTITLEMENTS", "").strip()
    if not raw_env:
        return {"success": False, "reason": "STITCH_SERVER_TIER_ENTITLEMENTS not set"}

    parsed = _parse_tier_env(raw_env)
    if not parsed:
        return {"success": False, "reason": "no valid entries parsed"}

    now = _utcnow()

    async def _seed(session: Any) -> dict:
        for role, plugin_ids in parsed:
            for pid in plugin_ids:
                stmt = sqlite_insert(RolePluginGrant).values(
                    role=role,
                    plugin_id=pid,
                    updated_at=now,
                    updated_by=admin_id,
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=["role", "plugin_id"],
                    set_={"updated_at": now, "updated_by": admin_id},
                )
                await session.execute(stmt)
        session.add(
            PluginGrantAudit(
                ts=now,
                admin_user_id=admin_id,
                action="seed",
                scope="role",
                target="env",
                plugin_id="*",
                granted=None,
            )
        )
        await session.flush()
        return {"success": True}

    result = await run_in_session(_seed)
    invalidate_entitlements_cache()
    return result


def _parse_tier_env(raw: str) -> list[tuple[str, list[str]]]:
    """Parse ``"user=a,b;premium=*"`` into ``[(role, [pid,...])]``.

    Skips entries with unknown roles.  Never raises.
    """
    out: list[tuple[str, list[str]]] = []
    for assignment in raw.split(";"):
        assignment = assignment.strip()
        if "=" not in assignment:
            continue
        role_part, plugins_part = assignment.split("=", 1)
        role = role_part.strip()
        if not role or not valid_role(role):
            logger.warning("seed_from_env: skipping unknown role %r", role)
            continue
        plugin_ids = [
            p.strip() for p in plugins_part.split(",") if p.strip()
        ]
        if plugin_ids:
            out.append((role, plugin_ids))
    return out


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _get_user_role(user_id: int) -> str | None:
    """Read a user's role from ``auth_users`` (None if missing)."""
    from stitch_backend.domains.auth.models import User

    async def _fetch(session: Any) -> str | None:
        stmt = select(User.role).where(User.id == user_id)
        result = await session.execute(stmt)
        row = result.first()
        return str(row[0]) if row else None

    try:
        return await run_in_read_session(_fetch)
    except Exception as exc:  # noqa: BLE001 — tolerant
        logger.warning("_get_user_role(%s) failed: %s", user_id, exc)
        return None
