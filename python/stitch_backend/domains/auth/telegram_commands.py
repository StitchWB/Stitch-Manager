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


async def exchange_telegram_code(code: str) -> tuple[User, list[str], str, Any, bool]:
    """Activate a one-time code and create a local session.

    Returns ``(user, entitlements, raw_token, expires_at, tg_admin)``.
    ``tg_admin`` is propagated from the activate response so callers
    (``login_telegram`` route, ``cmd_login_telegram`` command) can
    promote the local user to ``admin`` (PROMOTE ONLY — never demotes).

    Raises on activation / session failure — callers map the error
    (command: ``{success: False, error}``; auth route: 401 with a
    friendly detail).
    """
    hwid = derive_hwid()
    activation = ActivationService()
    state = await activation.activate(code, hwid)
    tg_admin = state.tg_admin

    async def _op(db: AsyncSession) -> tuple[User, str, Any]:
        user = await _ensure_telegram_user(db)
        raw_token, expires_at = await auth_service.create_session(db, user.id)
        return user, raw_token, expires_at

    user, raw_token, expires_at = await run_in_session(_op)
    return user, list(state.entitlements), raw_token, expires_at, tg_admin


async def _promote_to_admin_if_needed(user: User, tg_admin: bool) -> User:
    """Promote ``user`` to admin when ``tg_admin`` is True (PROMOTE ONLY).

    Never demotes — a manual demotion via the Users page persists because
    ``tg_admin=False`` leaves the role untouched.  Returns the (possibly
    updated) user detached from a fresh session.
    """
    if not tg_admin or user.role == "admin":
        return user

    async def _promote(db: AsyncSession) -> User:
        u = await auth_service.get_user(db, user.id)
        if u is not None and u.role != "admin":
            u.role = "admin"
        return u

    return await run_in_session(_promote)


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
        user, entitlements, raw_token, _expires_at, tg_admin = await exchange_telegram_code(code)
    except Exception as exc:  # noqa: BLE001 — surface as command error
        return {"success": False, "error": _map_activation_error(exc)}

    user = await _promote_to_admin_if_needed(user, tg_admin)

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
