"""Plugin entitlement service — effective entitlements computation.

Public contract (imported by sibling agents / marketplace gating):

  - :func:`get_effective_entitlements` — role ∪ group-grants ∪ user-grants
    − user-revokes ∪ legacy activation (additive, non-wildcard only).
    Admin → ``{"*"}``.  Desktop (no caller context) → ``{"*"}``.
  - :func:`is_entitled_to` — ``"*"`` or membership.
  - :func:`resolve_provider_plugin_id` — service id → canonical package id
    via :class:`autoreg.plugin.loader.PluginLoader`; ``None`` when absent.
  - :func:`get_required_tier` — lowest role whose grants include the plugin
    or ``"*"``; ``None`` if no role grants it.
  - :func:`invalidate_entitlements_cache` — called on every grant write.

In-memory TTL cache (60 s) keyed by ``(user_id, role)``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from sqlalchemy import select

from stitch_backend.database import run_in_read_session

from .activation import ActivationService
from .models import GroupPluginGrant, RolePluginGrant, UserPluginGrant

logger = logging.getLogger(__name__)

#: Cache TTL in seconds.
_CACHE_TTL: float = 60.0

#: ``(user_id, role)`` → ``(monotonic_ts, entitlements_set)``.
_CACHE: dict[tuple[int | None, str | None], tuple[float, set[str]]] = {}


def invalidate_entitlements_cache(
    *, user_id: int | None = None, role: str | None = None
) -> None:
    """Drop cached entitlement entries.

    - No args → clear the entire cache.
    - ``user_id`` given → drop all entries for that user (any role).
    - ``role`` given → drop all entries for that role (any user).
    - Both given → drop entries matching either.
    """
    if user_id is None and role is None:
        _CACHE.clear()
        return
    keys_to_drop = [
        key
        for key in _CACHE
        if (user_id is not None and key[0] == user_id)
        or (role is not None and key[1] == role)
    ]
    for key in keys_to_drop:
        _CACHE.pop(key, None)


async def get_effective_entitlements(
    user_id: int | None, role: str | None
) -> set[str]:
    """Return the effective plugin entitlement set for ``(user_id, role)``.

    Semantics (plan §distribution):

      - ``role == "admin"`` → ``{"*"}`` (hard rule).
      - ``user_id is None and role is None`` (desktop / no caller context)
        → ``{"*"}``.
      - Otherwise: ``role_plugin_grants[role]``
        ∪ ``group_plugin_grants`` (every group the user is a member of)
        ∪ ``user_plugin_grants(granted=True)``
        − ``user_plugin_grants(granted=False)``
        ∪ legacy ``.activation`` entitlements (additive, non-wildcard only).

    A per-user revoke (``granted=False``) wins over a group grant because
    group grants are applied before the user-override subtraction.

    ``"*"`` in the set means all plugins.  Cached for 60 s; call
    :func:`invalidate_entitlements_cache` on grant writes.
    """
    # Hard rules first — no cache needed for these.
    if role == "admin":
        return {"*"}
    if user_id is None and role is None:
        # FIX 4 (P1): Desktop (auth disabled) → {"*"}.  Guest (auth enabled,
        # no caller context) → NO wildcard; fall through to the grant
        # computation below which will be empty (no role, no user grants)
        # plus legacy additive (effectively empty without .activation
        # specifics).  This prevents a guest from getting full access.
        from stitch_backend.config import get_settings
        if not get_settings().auth_enabled:
            return {"*"}

    cache_key = (user_id, role)
    now = time.monotonic()
    cached = _CACHE.get(cache_key)
    if cached is not None:
        ts, ents = cached
        if now - ts < _CACHE_TTL:
            return set(ents)  # copy so callers can't mutate the cache

    entitlements: set[str] = set()

    # 1. Role grants.
    if role is not None:
        role_grants = await _read_role_grants(role)
        entitlements |= role_grants

    # 1.5 Group grants (additive) — every group the user belongs to adds its
    # granted plugins.  Applied BEFORE user overrides so a per-user revoke
    # (granted=False) still wins over a group grant.
    if user_id is not None:
        entitlements |= await _read_group_grants(user_id)

    # 2 + 3. User overrides (add granted=True, remove granted=False).
    if user_id is not None:
        user_grants = await _read_user_grants(user_id)
        for pid, granted in user_grants.items():
            if granted:
                entitlements.add(pid)
            else:
                entitlements.discard(pid)

    # 4. Legacy activation entitlements — additive, non-wildcard only.
    if "*" not in entitlements:
        legacy = await _read_legacy_entitlements()
        for pid in legacy:
            if pid != "*":
                entitlements.add(pid)

    _CACHE[cache_key] = (now, set(entitlements))
    return entitlements


def is_entitled_to(plugin_id: str, entitlements: set[str]) -> bool:
    """True if ``plugin_id`` is entitled per ``entitlements``.

    ``"*"`` in the set = all plugins; else exact membership.
    """
    return "*" in entitlements or plugin_id in entitlements


async def resolve_provider_plugin_id(provider_name: str) -> str | None:
    """Resolve a service id (e.g. ``"kiro"``) to a canonical package id.

    Uses :class:`autoreg.plugin.loader.PluginLoader` to find the installed
    package directory, then reads the ``id`` field from its
    ``plugin.json``.  Returns ``None`` when not installed or any error.

    FIX 3 (P1): When PluginLoader fails (e.g. a kind=provider plugin
    without a valid ``service`` field — ``validate_manifest`` rejects it),
    fall back to :data:`PLUGIN_PROVIDERS` which is populated by
    :func:`load_plugin_providers` reading raw JSON without validation.
    If a provider class is registered, derive the package dir from the
    class module file path (``inspect.getfile``) and read the manifest id.

    If a provider class exists but its manifest id genuinely cannot be
    determined, FAIL CLOSED — return a sentinel so :func:`_check_entitlement`
    denies rather than skips (a registered provider that can't be
    identified is suspicious).  ``None`` still means "not installed".
    Never raises.
    """
    # ── 1. PluginLoader (matches manifest service/services fields) ──────
    try:
        from autoreg.plugin.loader import PluginLoader

        loader = PluginLoader()
        pkg_dir = loader.resolve(provider_name)
        if pkg_dir is not None:
            manifest_path = pkg_dir / "plugin.json"
            if manifest_path.is_file():
                raw = json.loads(manifest_path.read_text(encoding="utf-8"))
                pid = str(raw.get("id", ""))
                return pid or None
    except Exception as exc:  # noqa: BLE001 — tolerant, never raises
        logger.debug("resolve_provider_plugin_id(%s) failed: %s", provider_name, exc)

    # ── 2. PLUGIN_PROVIDERS fallback (kind=provider plugins) ────────────
    # load_plugin_providers scans plugins-local + cache for kind=provider
    # packages, reading raw JSON without validate_manifest.  A provider
    # plugin with no/invalid service field is missed by PluginLoader but
    # still loaded here → _build_provider finds it → must be gated.
    try:
        from autoreg.providers.registry import (
            get_plugin_provider,
            get_plugin_provider_dir,
            load_plugin_providers,
        )

        load_plugin_providers()  # refresh — respects STITCH_PLUGINS_DIR
        provider_cls = get_plugin_provider(provider_name)
        if provider_cls is not None:
            # Locate the package dir — prefer the stored dir, fall back to
            # inspect.getfile (may fail for modules not in sys.modules).
            pkg_dir = get_plugin_provider_dir(provider_name)
            if pkg_dir is None:
                import inspect
                from pathlib import Path

                try:
                    module_file = Path(inspect.getfile(provider_cls))
                    pkg_dir = module_file.parent
                except (TypeError, OSError):
                    pkg_dir = None
            if pkg_dir is not None:
                manifest_path = pkg_dir / "plugin.json"
                if manifest_path.is_file():
                    try:
                        raw = json.loads(
                            manifest_path.read_text(encoding="utf-8")
                        )
                        pid = str(raw.get("id", ""))
                        if pid:
                            return pid
                    except (OSError, ValueError):
                        pass
            # Provider class exists but manifest id can't be determined →
            # FAIL CLOSED: return a sentinel that no entitlement set will
            # match (except desktop wildcard {"*"}).
            return f"<provider-plugin:{provider_name}>"
    except Exception as exc:  # noqa: BLE001 — tolerant, never raises
        logger.debug(
            "resolve_provider_plugin_id(%s) PLUGIN_PROVIDERS fallback failed: %s",
            provider_name, exc,
        )

    return None


async def get_required_tier(plugin_id: str) -> str | None:
    """Return the lowest role whose grants include ``plugin_id`` or ``"*"``.

    Role ladder: ``user < vip < premium < elite < admin``.
    Returns ``None`` if no role grants the plugin.
    """
    from stitch_backend.domains.auth.roles import ROLE_LEVELS

    async def _fetch(session: Any) -> set[str]:
        stmt = select(RolePluginGrant.role).where(
            (RolePluginGrant.plugin_id == plugin_id)
            | (RolePluginGrant.plugin_id == "*")
        )
        result = await session.execute(stmt)
        return {str(row[0]) for row in result.all()}

    try:
        roles = await run_in_read_session(_fetch)
    except Exception as exc:  # noqa: BLE001 — tolerant
        logger.warning("get_required_tier(%s) DB read failed: %s", plugin_id, exc)
        return None

    if not roles:
        return None

    # Lowest role = smallest ROLE_LEVELS value among the matching roles.
    best_role: str | None = None
    best_level = 999
    for r in roles:
        level = ROLE_LEVELS.get(r, 0)
        if 0 < level < best_level:
            best_level = level
            best_role = r
    return best_role


async def get_required_tiers(plugin_ids: list[str]) -> dict[str, str | None]:
    """Bulk version of :func:`get_required_tier` — single DB query.

    FIX 5 (P1): marketplace listing called ``get_required_tier`` per
    plugin (N+1).  This loads all role grants in one query and computes
    the lowest granting role per plugin in memory, including ``"*"``
    (wildcard) role grants.

    Returns ``{plugin_id: lowest_role_or_None}`` for each requested id.
    """
    from stitch_backend.domains.auth.roles import ROLE_LEVELS

    async def _fetch(session: Any) -> list[tuple[str, str]]:
        stmt = select(RolePluginGrant.role, RolePluginGrant.plugin_id)
        result = await session.execute(stmt)
        return [(str(row[0]), str(row[1])) for row in result.all()]

    try:
        grants = await run_in_read_session(_fetch)
    except Exception as exc:  # noqa: BLE001 — tolerant
        logger.warning("get_required_tiers DB read failed: %s", exc)
        return dict.fromkeys(plugin_ids)

    # Build role → set of plugin_ids, and collect wildcard roles.
    role_to_plugins: dict[str, set[str]] = {}
    wildcard_roles: set[str] = set()
    for role, pid in grants:
        if pid == "*":
            wildcard_roles.add(role)
        else:
            role_to_plugins.setdefault(role, set()).add(pid)

    result: dict[str, str | None] = {}
    for pid in plugin_ids:
        matching_roles: set[str] = set()
        # Roles that grant this specific plugin
        for role, plugins in role_to_plugins.items():
            if pid in plugins:
                matching_roles.add(role)
        # Roles with wildcard grant cover all plugins
        matching_roles |= wildcard_roles

        if not matching_roles:
            result[pid] = None
            continue

        best_role: str | None = None
        best_level = 999
        for r in matching_roles:
            level = ROLE_LEVELS.get(r, 0)
            if 0 < level < best_level:
                best_level = level
                best_role = r
        result[pid] = best_role

    return result


# ── Internal DB readers ───────────────────────────────────────────────────────


async def _read_role_grants(role: str) -> set[str]:
    """Return the set of plugin_ids granted to ``role``."""

    async def _fetch(session: Any) -> set[str]:
        stmt = select(RolePluginGrant.plugin_id).where(
            RolePluginGrant.role == role
        )
        result = await session.execute(stmt)
        return {str(row[0]) for row in result.all()}

    try:
        return await run_in_read_session(_fetch)
    except Exception as exc:  # noqa: BLE001 — tolerant
        logger.warning("_read_role_grants(%s) failed: %s", role, exc)
        return set()


async def _read_user_grants(user_id: int) -> dict[str, bool]:
    """Return ``{plugin_id: granted}`` for ``user_id`` overrides."""

    async def _fetch(session: Any) -> dict[str, bool]:
        stmt = select(UserPluginGrant).where(UserPluginGrant.user_id == user_id)
        result = await session.execute(stmt)
        return {
            str(row.plugin_id): bool(row.granted)
            for row in result.scalars().all()
        }

    try:
        return await run_in_read_session(_fetch)
    except Exception as exc:  # noqa: BLE001 — tolerant
        logger.warning("_read_user_grants(%s) failed: %s", user_id, exc)
        return {}


async def _read_group_grants(user_id: int) -> set[str]:
    """Return the set of plugin_ids granted to any group ``user_id`` is in.

    Joins ``group_members`` (membership) to ``group_plugin_grants`` and
    unions the granted plugin_ids.  A user in multiple groups gets the union
    of all their groups' grants.
    """
    from stitch_backend.domains.groups.models import GroupMember

    async def _fetch(session: Any) -> set[str]:
        stmt = (
            select(GroupPluginGrant.plugin_id)
            .join(
                GroupMember,
                GroupMember.group_id == GroupPluginGrant.group_id,
            )
            .where(GroupMember.user_id == user_id)
        )
        result = await session.execute(stmt)
        return {str(row[0]) for row in result.all()}

    try:
        return await run_in_read_session(_fetch)
    except Exception as exc:  # noqa: BLE001 — tolerant
        logger.warning("_read_group_grants(%s) failed: %s", user_id, exc)
        return set()


async def _read_legacy_entitlements() -> list[str]:
    """Read entitlements from the legacy ``.activation`` file.

    Returns an empty list when not activated or on any error.  This is
    the additive legacy part — only explicit (non-wildcard) entries are
    merged by :func:`get_effective_entitlements`.

    FIX 6 (P1): the sync file I/O (``ActivationService().load()``) is
    wrapped in :func:`asyncio.to_thread` so it does not block the event
    loop on every cache miss.  Behavior is identical.
    """
    def _read() -> list[str]:
        try:
            state = ActivationService().load()
            if state is None:
                return []
            return list(state.entitlements)
        except Exception as exc:  # noqa: BLE001 — tolerant
            logger.debug("_read_legacy_entitlements failed: %s", exc)
            return []
    return await asyncio.to_thread(_read)
