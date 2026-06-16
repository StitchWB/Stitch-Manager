"""Command dispatcher — ``POST /api/{name}`` → command registry → handler.

This is the HTTP analogue of Tauri's ``invoke()``.  The frontend adapter calls
``safeInvoke("get_accounts", {...})`` which is translated to::

    POST http://localhost:25584/api/get_accounts
    Content-Type: application/json
    {"provider": "kiro"}

The dispatcher looks up the handler in :mod:`stitch_backend.core.command_registry`,
calls it with the JSON body, and returns the result as JSON.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from stitch_backend.core.command_registry import (
    CommandNotFoundError,
    get_command_handler,
    list_commands,
)

logger = logging.getLogger(__name__)

cmd_router = APIRouter(tags=["Commands"])


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
      - Validation error  → 422
      - Domain error      → 400  (with ``detail`` field)
      - Unexpected error  → 500
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

    # Execute
    try:
        result = await handler(body)
    except HTTPException:
        raise   # let FastAPI handle HTTPException directly
    except Exception as exc:
        logger.exception("Command '%s' failed", name)
        # Domain exceptions expose a `detail` attribute
        detail = getattr(exc, "detail", None) or str(exc)
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
