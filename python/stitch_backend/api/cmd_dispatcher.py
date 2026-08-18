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
from typing import Any, cast

from fastapi import APIRouter, HTTPException, Request
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
    from stitch_backend.config import get_settings

    if get_settings().auth_enabled:
        from stitch_backend.domains.auth.router import _current_user_optional

        user, _raw = await _current_user_optional(request)
        caller_role = user.role if user is not None else None
        caller_user_id = user.id if user is not None else None
        caller_username = user.username if user is not None else None
    if meta.admin_only and caller_role != "admin":
        raise HTTPException(
            status_code=403,
            detail=f"Command '{name}' requires admin role",
        )
    body["_caller_role"] = caller_role
    body["_caller_user_id"] = caller_user_id
    body["_caller_username"] = caller_username

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
    return value
