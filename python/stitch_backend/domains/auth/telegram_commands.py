"""Telegram-code login commands — exchange a TG-bot code for a local session.

Two commands wired to the command registry:

  - ``login_telegram`` ``{code: str}`` → exchanges the one-time code at the
    distribution server via :class:`ActivationService`, ensures a local
    ``telegram`` user exists (role ``user``; created with a random password
    since login is via TG code, not password), creates a session, and
    returns ``{success, user, entitlements, session_token}``.

    On failure returns ``{success: False, error: str}`` with a
    human-readable error mapped from the server response:

      * 404 → "Code not found"
      * 409 → "Code already used"
      * 403 → "Code revoked"
      * connection error → "Server unreachable"

  - ``get_telegram_status`` (readonly) → ``{activated, entitlements}`` from
    :meth:`ActivationService.load` (for the UI badge).
"""

from __future__ import annotations

import logging
import secrets
from typing import TYPE_CHECKING, Any

import httpx

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_session
from stitch_backend.domains.auth import service as auth_service
from stitch_backend.domains.plugin_distribution.activation import (
    ActivationService,
    derive_hwid,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from stitch_backend.domains.auth.models import User

logger = logging.getLogger(__name__)

#: Username + role for the Telegram-code login user.
_TELEGRAM_USERNAME = "telegram"
_TELEGRAM_ROLE = "user"


def _map_activation_error(exc: Exception) -> str:
    """Map a server/transport error to a human-readable string."""
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status == 404:
            return "Code not found"
        if status == 409:
            return "Code already used"
        if status == 403:
            return "Code revoked"
        return f"Activation failed ({status})"
    if isinstance(exc, (httpx.ConnectError, httpx.RequestError)):
        return "Server unreachable"
    return f"Activation failed: {exc}"


async def _ensure_telegram_user(db: AsyncSession) -> User:
    """Return the local ``telegram`` user, creating it if absent.

    The password is a random 32-byte hex string — login is via TG code, not
    password, so nobody needs to know it.  The FIRST user ever created gets
    role ``admin`` (bootstrap, same spirit as ``/api/auth/setup``) so the
    owner logging in via Telegram lands with full access; later TG logins
    are regular users.
    """
    user = await auth_service.get_user_by_username(db, _TELEGRAM_USERNAME)
    if user is not None:
        return user
    random_pw = secrets.token_hex(32)
    role = "admin" if await auth_service.count_users(db) == 0 else _TELEGRAM_ROLE
    return await auth_service.create_user(
        db, username=_TELEGRAM_USERNAME, password=random_pw, role=role
    )


async def ensure_oidc_user(
    db: AsyncSession, tg_id: int, preferred_username: str | None
) -> User:
    """Return the local user for Telegram id *tg_id*, creating it if absent.

    The authoritative binding is the ``telegram_id`` column (TG handles
    change; the numeric id does not), so each Telegram account keeps exactly
    one Stitch user row and the Users page shows who is who.  The username
    is the TG handle (*preferred_username*) when free — so the name is
    visible — with a deterministic ``tg_<id>`` fallback.

    Rows created before the column existed (username ``tg_<id>`` or the
    handle) are ADOPTED: the first OIDC login stamps ``telegram_id`` onto
    them instead of creating a duplicate.  A pre-existing row whose name
    matches the handle but has no ``telegram_id`` (e.g. an admin-created
    password user) is linked the same way — account linking is intentional;
    user creation is admin-only, so this is not an attacker vector.

    The password is a random 32-byte hex string — login is via OIDC
    ``id_token``, not password.  The FIRST user ever created gets role
    ``admin`` (bootstrap, same spirit as ``/api/auth/setup``); later OIDC
    logins are regular users.
    """
    user = await auth_service.get_user_by_telegram_id(db, tg_id)
    if user is not None:
        return user

    fallback = f"tg_{tg_id}"
    handle = (preferred_username or "").strip()

    # Adopt pre-column rows (stable continuity across the migration).
    for candidate in ((fallback, handle) if handle else (fallback,)):
        user = await auth_service.get_user_by_username(db, candidate)
        if user is not None:
            if user.telegram_id is None:
                user.telegram_id = tg_id
                await db.flush()
            return user

    random_pw = secrets.token_hex(32)
    role = "admin" if await auth_service.count_users(db) == 0 else _TELEGRAM_ROLE
    username = fallback
    if handle and await auth_service.get_user_by_username(db, handle) is None:
        username = handle
    try:
        return await auth_service.create_user(
            db, username=username, password=random_pw, role=role, telegram_id=tg_id
        )
    except StitchError:
        # Handle raced (taken between the check and the insert) — the
        # racing insert bound the telegram_id, so re-lookup wins; else
        # fall back to the deterministic tg_<id> name.
        user = await auth_service.get_user_by_telegram_id(db, tg_id)
        if user is not None:
            return user
        return await auth_service.create_user(
            db, username=fallback, password=random_pw, role=role, telegram_id=tg_id
        )


async def exchange_telegram_code(code: str) -> tuple[User, list[str], str, Any, bool, str | None]:
    """Activate a one-time code and create a local session.

    Returns ``(user, entitlements, raw_token, expires_at, tg_admin, tier)``.
    ``tg_admin`` is propagated from the activate response so callers
    (``login_telegram`` route, ``cmd_login_telegram`` command) can
    sync the local user's role.  ``tier`` is the tier label from the
    bot's TG_TIER_MAP (None when the tier system is disabled).

    Raises on activation / session failure — callers map the error
    (command: ``{success: False, error}``; auth route: 401 with a
    friendly detail).
    """
    hwid = derive_hwid()
    activation = ActivationService()
    state = await activation.activate(code, hwid)
    tg_admin = state.tg_admin
    tier = state.tier

    async def _op(db: AsyncSession) -> tuple[User, str, Any]:
        user = await _ensure_telegram_user(db)
        raw_token, expires_at = await auth_service.create_session(db, user.id)
        return user, raw_token, expires_at

    user, raw_token, expires_at = await run_in_session(_op)
    return user, list(state.entitlements), raw_token, expires_at, tg_admin, tier


async def _sync_role_and_tier(user: User, tg_admin: bool, tier: str | None) -> User:
    """Sync the local user's role and tg_tier from the TG bot's signals.

    Role sync rule (bootstrap + promote-only, never demotes):
      - First user ever (bootstrap) → ``'admin'`` so a fresh instance
        always has an owner-admin.
      - ``tg_admin=True`` → promote to ``'admin'``.
      - Else if ``tier`` is in ROLE_LEVELS and above the current role →
        promote to ``tier``.
      - Manual role changes via the Users page persist (no demotion on
        the next login).

    ``tg_tier`` is always set to ``tier`` (None when the tier system is
    off) so the Users page can display the source tier.

    Returns the (possibly updated) user detached from a fresh session.
    """
    from stitch_backend.domains.auth.roles import ROLE_LEVELS, role_level

    mirror = "admin" if tg_admin else (tier if tier in ROLE_LEVELS else None)

    async def _sync(db: AsyncSession) -> User:
        u = await auth_service.get_user(db, user.id)
        if u is None:
            return user
        total = await auth_service.count_users(db)
        if total <= 1:
            u.role = "admin"  # bootstrap: first user owns the instance
        elif mirror and role_level(mirror) > role_level(u.role):
            u.role = mirror
        u.tg_tier = tier
        return u

    return await run_in_session(_sync)


@register_command("login_telegram")
async def cmd_login_telegram(params: dict) -> dict:
    """Exchange a Telegram-bot code for a local session.

    Params: ``{code: str}``.  Returns ``{success, user, entitlements,
    session_token}`` on success or ``{success: False, error: str}`` on
    failure.  The web login flow uses ``POST /api/auth/login_telegram``
    (same core, sets the session cookie); this command stays for the
    desktop command-dispatcher path.
    """
    code = str(params.get("code", "")).strip()
    if not code:
        return {"success": False, "error": "Code is required"}

    try:
        user, entitlements, raw_token, _expires_at, tg_admin, tier = await exchange_telegram_code(code)
    except Exception as exc:  # noqa: BLE001 — surface as command error
        return {"success": False, "error": _map_activation_error(exc)}

    user = await _sync_role_and_tier(user, tg_admin, tier)

    return {
        "success": True,
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role,
        },
        "entitlements": entitlements,
        "session_token": raw_token,
    }


@register_command("get_telegram_status", readonly=True)
async def cmd_get_telegram_status(params: dict) -> dict:
    """Return ``{activated, entitlements}`` from the persisted activation."""
    activation = ActivationService()
    state = activation.load()
    if state is None:
        return {"activated": False, "entitlements": []}
    return {"activated": True, "entitlements": list(state.entitlements)}
