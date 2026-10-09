"""Clean-error helpers for the ``*_dual`` routers.

There is no built-in fallback behind the dual routes anymore: when the
plugin is absent or unhealthy the caller gets a structured error identical
in shape to command errors (``{"detail": ...}`` + 4xx/504), never a silent
fallback and never a traceback.
"""

from __future__ import annotations

import logging
from typing import Any, NoReturn

from fastapi import HTTPException

logger = logging.getLogger(__name__)


async def require_plugin_entitlement(plugin_id: str, body: dict[str, Any]) -> None:
    """403 when the caller is not entitled to ``plugin_id`` — the same
    gate :func:`bridge.call_plugin_command` applies to namespaced calls,
    so a legacy dual-route name cannot bypass it.

    Lazy import so test patches on the entitlements module take effect
    at call time.
    """
    from stitch_backend.domains.plugin_distribution.entitlements import (
        get_effective_entitlements,
        is_entitled_to,
    )

    entitlements = await get_effective_entitlements(
        body.get("_caller_user_id"), body.get("_caller_role")
    )
    if not is_entitled_to(plugin_id, entitlements):
        raise HTTPException(
            status_code=403,
            detail=f"Not entitled to plugin: {plugin_id}",
        )


def raise_plugin_unavailable(plugin_id: str, command: str) -> NoReturn:
    """400 — the plugin serving *command* is not installed or not running."""
    raise HTTPException(
        status_code=400,
        detail=(
            f"Command '{command}' requires the '{plugin_id}' plugin, "
            "which is not installed or not running"
        ),
    )


def _rejection_line(exc: Exception) -> str:
    """First line of a JSON-RPC error response ('[code] message').

    Plugin-side validation messages can carry embedded newlines; the
    rejection log must stay a single line.
    """
    return str(exc).splitlines()[0]


def log_plugin_call_failure(
    logger: logging.Logger, prefix: str, command: str, exc: Exception
) -> None:
    """Log a failed dual plugin call.

    ``RpcCallError`` is a business rejection — the plugin answered the
    protocol correctly with an error payload, an expected outcome, so it
    gets one line without a traceback.  Transport failures (host died,
    timeout) are unexpected and keep the traceback.
    """
    from autoreg.plugin.rpc import RpcCallError

    if isinstance(exc, RpcCallError):
        logger.warning(
            "%s: plugin rejected '%s': %s", prefix, command, _rejection_line(exc)
        )
    else:
        logger.warning(
            "%s: plugin error during '%s'", prefix, command, exc_info=True
        )


def raise_plugin_call_failed(plugin_id: str, command: str, exc: Exception) -> NoReturn:
    """504 on RPC timeout, else 400 — mirrors bridge.py's error mapping.

    The exception itself is logged server-side, never embedded in the
    response detail (it can carry internal paths / tracebacks).
    """
    from autoreg.plugin.rpc import RpcCallError
    from stitch_backend.domains.plugin_runtime.host import PluginCallTimeout

    if isinstance(exc, PluginCallTimeout):
        raise HTTPException(
            status_code=504,
            detail=f"Plugin '{plugin_id}' command '{command}' timed out",
        ) from exc
    if isinstance(exc, RpcCallError):
        logger.warning(
            "Plugin '%s' command '%s' rejected: %s",
            plugin_id,
            command,
            _rejection_line(exc),
        )
    else:
        logger.warning(
            "Plugin '%s' command '%s' failed", plugin_id, command, exc_info=exc
        )
    raise HTTPException(
        status_code=400,
        detail=f"Plugin '{plugin_id}' command '{command}' failed",
    ) from exc


__all__ = [
    "raise_plugin_unavailable",
    "raise_plugin_call_failed",
    "require_plugin_entitlement",
    "log_plugin_call_failure",
]
