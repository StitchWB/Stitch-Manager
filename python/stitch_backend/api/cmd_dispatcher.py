"""Command dispatcher — ``POST /api/{name}`` → command registry → handler.

This is the HTTP analogue of the backend's ``invoke()``.  The frontend adapter calls
``safeInvoke("get_accounts", {...})`` which is translated to::

    POST http://localhost:25584/api/get_accounts
    Content-Type: application/json
    {"provider": "kiro"}

The dispatcher looks up the handler in :mod:`stitch_backend.core.command_registry`,
calls it with the JSON body, and returns the result as JSON.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime
from typing import Any, cast

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from stitch_backend.core.command_registry import (
    CommandNotFoundError,
    get_command_handler,
    get_command_meta,
    list_commands,
)
from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error

# Import so the @register_command decorator in bridge.py fires at startup
# (registers ``list_service_plugins``).  The dispatcher also routes
# ``plugin.{id}.{cmd}`` names through this module before the registry lookup.
import stitch_backend.domains.plugin_runtime.bridge  # noqa: F401

logger = logging.getLogger(__name__)

cmd_router = APIRouter(tags=["Commands"])

#: Default timeout for command execution (seconds).
#:
#: Chosen to be below the SQLAlchemy write pool timeout (30s) so the
#: dispatcher kills stuck commands *before* the pool timeout cascades
#: and every other command fails with a 30s pool-timeout traceback.
DEFAULT_COMMAND_TIMEOUT: float = 25.0


# ── Discover available commands ───────────────────────────────────────────────

@cmd_router.get("/cmd/")
async def list_available_commands() -> dict[str, Any]:
    """Return the full list of registered command names."""
    return {"commands": list_commands()}


# ── Dispatch ──────────────────────────────────────────────────────────────────

@cmd_router.post("/{name}")
async def dispatch_command(name: str, request: Request) -> JSONResponse:
    """Dispatch a named command with the JSON body as params.

    Errors are mapped to HTTP status codes:

      - Unknown command   → 404
      - Validation error  → 400  (pydantic ``ValidationError``, one-line warning)
      - Domain error      → 400  (``StitchError``, one-line warning)
      - Input rejection   → 400  (``ValueError`` from domain hand-validation,
        one-line warning, no traceback)
      - Timeout           → 504  (command exceeded its per-command or default timeout)
      - Unexpected error  → 400  (full traceback logged; 400 is the established
        contract — frontend and e2e tests treat any command error as 4xx)
    """
    # Parse body (empty body is fine → {})
    try:
        body = await request.json()
    except Exception:
        body = {}

    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Request body must be a JSON object")

    # ── Plugin command routing ──────────────────────────────────────────────
    # Namespaced commands ``plugin.{id}.{cmd}`` are routed to the plugin
    # runtime BEFORE the command-registry lookup.  This avoids dynamic
    # re-registration of plugin command names (which would spam the
    # overwrite-warning log in command_registry.register_command).
    # Caller identity is resolved here so the entitlement check in the
    # bridge has ``_caller_role`` / ``_caller_user_id``.
    if name.startswith("plugin."):
        caller_role_plugin: str | None = "admin"
        caller_user_id_plugin: int | None = None
        caller_username_plugin: str | None = None
        caller_telegram_id_plugin: int | None = None
        from stitch_backend.config import get_settings as _get_settings_plugin

        if _get_settings_plugin().auth_enabled:
            from stitch_backend.domains.auth.router import _current_user_optional

            _user, _preview_role, _raw = await _current_user_optional(request)
            caller_role_plugin = (
                (_preview_role or _user.role) if _user is not None else None
            )
            caller_user_id_plugin = _user.id if _user is not None else None
            caller_username_plugin = _user.username if _user is not None else None
            caller_telegram_id_plugin = (
                _user.telegram_id if _user is not None else None
            )
        body["_caller_role"] = caller_role_plugin
        body["_caller_user_id"] = caller_user_id_plugin
        body["_caller_username"] = caller_username_plugin
        body["_caller_telegram_id"] = caller_telegram_id_plugin

        from stitch_backend.domains.plugin_runtime.bridge import call_plugin_command

        _plugin_result = await call_plugin_command(name, body)
        return JSONResponse(content=_serialise(_plugin_result))

    # ── Dual-format routing for google_sheets_* commands ───────────────────
    # Same pattern as the generic plugin.* route above: when a healthy
    # ``stitch-sheets`` plugin host is registered, google_sheets_* commands
    # are routed to the plugin (stripping the ``google_sheets_`` prefix)
    # BEFORE falling through to the built-in handler.
    from stitch_backend.domains.plugin_runtime.sheets_dual import (
        _FALLTHROUGH as _SHEETS_FALLTHROUGH,
    )
    from stitch_backend.domains.plugin_runtime.sheets_dual import (
        try_sheets_dual_route,
    )

    _sheets_result = await try_sheets_dual_route(name, body)
    if _sheets_result is not _SHEETS_FALLTHROUGH:
        return JSONResponse(content=_serialise(_sheets_result))

    # ── Dual-format routing for email_* / email_inbox_* commands ─────────
    # Same pattern as the google_sheets_* dual route above: when a healthy
    # ``stitch-mail`` plugin host is registered, email_* / email_inbox_*
    # commands are routed to the plugin (stripping the prefix) BEFORE
    # falling through to the built-in handler.  Caller identity is
    # forwarded as ``caller_user_id`` / ``caller_role`` (totp_dual pattern).
    from stitch_backend.domains.plugin_runtime.mail_dual import (
        _FALLTHROUGH as _MAIL_FALLTHROUGH,
    )
    from stitch_backend.domains.plugin_runtime.mail_dual import (
        try_mail_dual_route,
    )

    _mail_result = await try_mail_dual_route(name, body)
    if _mail_result is not _MAIL_FALLTHROUGH:
        return JSONResponse(content=_serialise(_mail_result))

    # ── Dual-format routing for opencode_config commands ─────────────────
    # Same pattern as google_sheets_* / email_* above: when a healthy
    # ``stitch-opencode`` plugin host is registered, opencode_config commands
    # are routed to the plugin (identity mapping — no prefix to strip) BEFORE
    # falling through to the built-in handler.
    from stitch_backend.domains.plugin_runtime.opencode_dual import (
        _FALLTHROUGH as _OPENCODE_FALLTHROUGH,
    )
    from stitch_backend.domains.plugin_runtime.opencode_dual import (
        try_opencode_dual_route,
    )

    _opencode_result = await try_opencode_dual_route(name, body)
    if _opencode_result is not _OPENCODE_FALLTHROUGH:
        return JSONResponse(content=_serialise(_opencode_result))

    # ── Dual-format routing for radar commands ─────────────────────────────
    # Same pattern as opencode_config above: when a healthy
    # ``stitch-radar`` plugin host is registered, get_radar_offers /
    # get_radar_stats commands are routed to the plugin (identity mapping
    # — no prefix to strip) BEFORE falling through to the built-in handler.
    # Friends (get_friends) is NOT part of this route — it stays core-only.
    from stitch_backend.domains.plugin_runtime.radar_dual import (
        _FALLTHROUGH as _RADAR_FALLTHROUGH,
    )
    from stitch_backend.domains.plugin_runtime.radar_dual import (
        try_radar_dual_route,
    )

    _radar_result = await try_radar_dual_route(name, body)
    if _radar_result is not _RADAR_FALLTHROUGH:
        return JSONResponse(content=_serialise(_radar_result))

    # ── Dual-format routing for card commands ──────────────────────────────
    # Same pattern as radar above: when a healthy ``stitch-cards`` plugin
    # host is registered, generate_cards / check_card_rust / find_live_card
    # commands are routed to the plugin (identity mapping — no prefix to
    # strip) BEFORE falling through to the built-in handler.
    from stitch_backend.domains.plugin_runtime.cards_dual import (
        _FALLTHROUGH as _CARDS_FALLTHROUGH,
    )
    from stitch_backend.domains.plugin_runtime.cards_dual import (
        try_cards_dual_route,
    )

    _cards_result = await try_cards_dual_route(name, body)
    if _cards_result is not _CARDS_FALLTHROUGH:
        return JSONResponse(content=_serialise(_cards_result))

    # Look up handler
    try:
        handler = get_command_handler(name)
    except CommandNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown command: '{name}'",
        ) from None

    # Caller identity: resolve once, enforce admin_only, and inject the role
    # into params (``_caller_role``) so tier-gated handlers (scenarios etc.)
    # can authorize without re-resolving the session.  Auth disabled
    # (single-trusted-user desktop) → caller is treated as admin; a guest
    # session (auth on, no user) resolves to None (below every tier).
    # ``_caller_user_id`` / ``_caller_username`` are also injected so
    # per-owner handlers (proxy_library, totp) can scope reads/writes
    # without re-resolving the session.  Auth disabled → both are None.
    meta = get_command_meta(name)
    caller_role: str | None = "admin"
    caller_user_id: int | None = None
    caller_username: str | None = None
    caller_telegram_id: int | None = None
    from stitch_backend.config import get_settings

    if get_settings().auth_enabled:
        from stitch_backend.domains.auth.router import _current_user_optional

        user, preview_role, _raw = await _current_user_optional(request)
        # Effective role = preview_role (when admin is previewing) or real
        # role.  This single value drives meta.admin_only enforcement,
        # ensure_permission (reads params["_caller_role"]), and scenario
        # tier gating (role_at_least).  Identity/scope stays the real user.
        caller_role = (preview_role or user.role) if user is not None else None
        caller_user_id = user.id if user is not None else None
        caller_username = user.username if user is not None else None
        caller_telegram_id = user.telegram_id if user is not None else None
    if meta.admin_only and caller_role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Command '{name}' requires admin role",
        )
    body["_caller_role"] = caller_role
    body["_caller_user_id"] = caller_user_id
    body["_caller_username"] = caller_username
    body["_caller_telegram_id"] = caller_telegram_id

    # Determine effective timeout from command metadata.
    #   None  → use DEFAULT_COMMAND_TIMEOUT
    #   -1    → opt out (no timeout)
    #   float → per-command timeout
    if meta.timeout == -1:
        effective_timeout: float | None = None
    elif meta.timeout is None:
        effective_timeout = DEFAULT_COMMAND_TIMEOUT
    else:
        effective_timeout = meta.timeout

    # Execute
    try:
        if effective_timeout is not None:
            try:
                result = await asyncio.wait_for(
                    handler(body), timeout=effective_timeout
                )
            except TimeoutError:
                logger.error(
                    "Command '%s' timed out after %.1fs", name, effective_timeout
                )
                raise HTTPException(
                    status_code=504,
                    detail=f"Command '{name}' timed out after {effective_timeout}s",
                ) from None
        else:
            result = await handler(body)
    except HTTPException:
        raise  # let FastAPI handle HTTPException directly
    except ValidationError as exc:
        errors = exc.errors()
        first: dict[str, Any] = cast("dict[str, Any]", errors[0]) if errors else {}
        loc = ".".join(str(p) for p in first.get("loc", ()))
        msg = first.get("msg", "")
        summary = f"{loc}: {msg}"[:200]
        logger.warning("Command '%s' validation error: %s", name, summary)
        raise HTTPException(status_code=400, detail=summary) from exc
    except StitchError as exc:
        logger.warning("Command '%s' domain error: %s", name, str(exc.detail)[:200])
        raise HTTPException(status_code=400, detail=exc.detail) from exc
    except ValueError as exc:
        # Domains raise ValueError for expected input-validation failures
        # (e.g. "TOTP secret is required") — one line, no traceback spam.
        logger.warning("Command '%s' rejected input: %s", name, str(exc)[:200])
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Command '%s' failed", name)
        # Domain exceptions expose a `detail` attribute; sanitize the raw
        # exception string to strip secret-bearing URL params before it
        # reaches the client.
        # NOTE: status stays 400 (not 500) — the established contract that
        # the frontend and the e2e test suite rely on for command errors.
        detail = getattr(exc, "detail", None) or _sanitize_error(exc, secret="")
        raise HTTPException(status_code=400, detail=detail) from exc

    # Return
    return JSONResponse(content=_serialise(result))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _json_safe(value: Any) -> Any:
    """Recursively coerce plain dicts/lists into JSON-safe data.

    Handlers that build raw dicts (groups et al.) may embed ``datetime``
    values; ``JSONResponse`` renders with plain ``json.dumps`` and would
    raise ``TypeError`` on them, so sanitise here.
    """
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


def _serialise(value: Any) -> Any:
    """Coerce the handler's return value into JSON-safe data.

    Pydantic models are dumped with ``by_alias=True`` so camelCase field
    names reach the frontend.  This removes the need for handlers to
    pre-serialise their return values.
    """
    if value is None:
        return {}
    # Pydantic models
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True)
    # Lists of Pydantic models
    if isinstance(value, list) and value and hasattr(value[0], "model_dump"):
        return [v.model_dump(mode="json", by_alias=True) for v in value]
    # Plain dicts/lists: recursively sanitise datetimes et al.
    return _json_safe(value)
