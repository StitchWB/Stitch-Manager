"""REST API router for the auth domain.

Mounted under the existing ``/api`` prefix (via :mod:`stitch_backend.api.router`)
at ``/api/auth/*``.  The auth subsystem is always wired up when
``auth_enabled`` is on; whether login is *required* is decided by the
middleware based on the effective ``required = auth_required OR
(has_users AND enforce_login)`` contract:

  - Fresh desktop (``auth_required=False``, no users) → NOT required →
    every ``/api/*`` request passes through without a session; the auth
    endpoints below remain functional so the user can opt in by creating
    a local account via ``/api/auth/setup``.
  - Desktop with users (opted in) and ``enforce_login=True`` (default) →
    required → 401 without session.
  - Desktop with users but ``enforce_login=False`` (admin opted out via
    ``POST /api/auth/policy``) → NOT required → unauthenticated requests
    pass through; the admin stays logged in and can flip it back on.
  - VDS (``STITCH_AUTH_REQUIRED=1``) → required from first run
    (bypasses ``enforce_login``).

When required, the middleware gates every other ``/api/*`` route; these
auth endpoints are the public exceptions:

  GET  /api/auth/status          — always public; reports enabled + has_users + required + enforce_login
  POST /api/auth/login           — sets cookie + returns user; 401 on bad creds
  POST /api/auth/setup           — creates first admin when zero users (403 otherwise)
  POST /api/auth/logout          — clears cookie, deletes session
  GET  /api/auth/me              — user object or 401
  POST /api/auth/preview_role (admin) — set/clear per-session role preview
  GET  /api/auth/users (admin)   — list without hashes
  POST /api/auth/users (admin)   — create; 409 on dup
  DELETE /api/auth/users/{id} (admin) — delete (not self; not last admin)
  POST /api/auth/policy (admin)  — persist enforce_login toggle
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from stitch_backend.config import get_settings
from stitch_backend.domains.auth import (
    account_routes,
    deeplink_routes,
    login_routes,
    oidc_routes,
    permissions_routes,
    users_routes,
)
from stitch_backend.domains.auth import (
    service as auth_service,
)
from stitch_backend.domains.auth.helpers import (
    _current_user_optional,
    _resolve_raw_token,
    get_current_user,
    require_role,
)

__all__ = [
    "PUBLIC_PATHS",
    "_current_user_optional",
    "auth_middleware_dispatch",
    "get_current_user",
    "httpx",
    "require_role",
    "router",
]

#: Public paths — middleware skips auth gate for these.
PUBLIC_PATHS: frozenset[str] = frozenset({
    "/api/auth/login",
    "/api/auth/login_telegram",
    "/api/auth/telegram-oidc",
    "/api/auth/deeplink/start",
    "/api/auth/deeplink/status",
    "/api/auth/deeplink/login",
    "/api/auth/status",
    "/api/auth/setup",
    "/api/auth/my_permissions",
    # X-Admin-Key auth (no session) — must be reachable without login.
    "/api/auth/tg-sync-user",
    # Raw distribution-server passthrough (public + rate-limited upstream).
    "/deeplink/start",
    "/deeplink/status",
    "/deeplink/exchange",
    "/partner-channels",
    "/rights",
})

router = APIRouter(prefix="/auth", tags=["Auth"])

# Route registration order is frozen: include order below reproduces it exactly.
router.include_router(login_routes.router)
router.include_router(deeplink_routes.router)
router.include_router(oidc_routes.router)
router.include_router(account_routes.router)
router.include_router(users_routes.router)
router.include_router(permissions_routes.router)


async def _login_required_by_policy() -> bool:
    """Return whether login is required by the has_users + enforce_login policy.

    Called only when ``auth_required`` is ``False`` (desktop), so the VDS
    path (``auth_required=True``) never hits the DB here.  Returns
    ``has_users AND enforce_login`` — a device with users can opt out of
    mandatory login when an admin has set ``enforce_login=False``.
    """
    from stitch_backend.database import get_session_factory

    factory = get_session_factory()
    async with factory() as db:
        count = await auth_service.count_users(db)
        enforce_login = await auth_service.get_enforce_login(db)
    return count > 0 and enforce_login


async def auth_middleware_dispatch(request: Request, call_next):
    """ASGI middleware: gate every ``/api/*`` request behind a valid session
    when auth is *required*.

    Effective ``required = auth_required OR (has_users AND enforce_login)``:
      - Fresh desktop (``auth_required=False``, no users) → NOT required →
        unauthenticated requests pass through; the auth endpoints
        (login/setup/me/users) remain fully functional so the user can opt
        in by creating a local account.
      - Desktop with users (opted in via setup) and ``enforce_login=True``
        (default) → required → 401 without session.
      - Desktop with users but ``enforce_login=False`` (admin opted out)
        → NOT required → unauthenticated requests pass through; the admin
        stays logged in and can flip it back on.
      - VDS (``STITCH_AUTH_REQUIRED=1``) → required from first run
        (bypasses ``enforce_login``).

    No-op when ``auth_enabled`` is off.  When required, every ``/api/*``
    request without a valid session is rejected with 401, except the public
    paths in :data:`PUBLIC_PATHS`.  ``/health`` and the root ``/`` stay
    open.  The WebSocket endpoint ``/api/events`` is also gated — the
    cookie arrives automatically on the WS handshake, so we reject the
    handshake with 401 when no valid session is present.
    """
    settings = get_settings()
    if not settings.auth_enabled:
        return await call_next(request)

    path = request.url.path

    # /health and the root are always open.
    if path == "/health" or path == "/":
        return await call_next(request)

    # Only /api/* is gated.
    if not path.startswith("/api/"):
        return await call_next(request)

    if path in PUBLIC_PATHS:
        return await call_next(request)

    required = settings.auth_required or await _login_required_by_policy()
    if not required:
        return await call_next(request)

    # WebSocket handshake — /api/events.
    if path == "/api/events" and request.scope.get("type") == "websocket":
        # The cookie arrives on the WS handshake; reject before accept.
        raw_token = _resolve_raw_token(request)
        if not raw_token:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Not authenticated"},
            )
        user, _preview, _ = await _current_user_optional(request)
        if user is None:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Not authenticated"},
            )
        return await call_next(request)

    # HTTP /api/* — check session.
    user, _preview, _ = await _current_user_optional(request)
    if user is None:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Not authenticated"},
        )
    return await call_next(request)
