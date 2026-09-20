"""Clean-error helpers for the ``*_dual`` routers.

There is no built-in fallback behind the dual routes anymore: when the
plugin is absent or unhealthy the caller gets a structured error identical
in shape to command errors (``{"detail": ...}`` + 4xx/504), never a silent
fallback and never a traceback.
"""

from __future__ import annotations

import logging
from typing import NoReturn

from fastapi import HTTPException

logger = logging.getLogger(__name__)


def raise_plugin_unavailable(plugin_id: str, command: str) -> NoReturn:
    """400 — the plugin serving *command* is not installed or not running."""
    raise HTTPException(
        status_code=400,
        detail=(
            f"Command '{command}' requires the '{plugin_id}' plugin, "
            "which is not installed or not running"
        ),
    )


def raise_plugin_call_failed(plugin_id: str, command: str, exc: Exception) -> NoReturn:
    """504 on RPC timeout, else 400 — mirrors bridge.py's error mapping.

    The exception itself is logged server-side, never embedded in the
    response detail (it can carry internal paths / tracebacks).
    """
    from stitch_backend.domains.plugin_runtime.host import PluginCallTimeout

    if isinstance(exc, PluginCallTimeout):
        raise HTTPException(
            status_code=504,
            detail=f"Plugin '{plugin_id}' command '{command}' timed out",
        ) from exc
    logger.warning(
        "Plugin '%s' command '%s' failed", plugin_id, command, exc_info=exc
    )
    raise HTTPException(
        status_code=400,
        detail=f"Plugin '{plugin_id}' command '{command}' failed",
    ) from exc


__all__ = ["raise_plugin_unavailable", "raise_plugin_call_failed"]
