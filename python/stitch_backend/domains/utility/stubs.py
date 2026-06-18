"""Stub command handlers for commands not yet fully ported.

These return safe defaults to prevent frontend 404 errors while real
implementations are being built.  Replace each stub with a real handler
as part of incremental porting.

Most stubs have been moved to real implementations:
- Logging: domains/logging/commands.py (SQLite-backed)
- Registration jobs: domains/registration/commands.py (in-memory)
- Background manager: domains/background_manager/commands.py (settings-backed)
- Proxy config/settings: domains/utility/commands.py (settings-backed)
- Observability: domains/utility/commands.py (app_logs-backed)
- Active accounts: domains/utility/commands.py (in-memory)
- IDE paths: domains/utility/commands.py (filesystem scan)
"""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command


# =============================================================================
# Misc stubs for commonly-called commands (not yet ported)
# =============================================================================

@register_command("get_status")
async def stub_get_status(params: dict) -> dict:
    """Return generic status."""
    return {"backend": "python", "status": "running"}


@register_command("get_pool_status")
async def stub_get_pool_status(params: dict) -> dict:
    """Return empty pool."""
    return {"accounts": [], "total": 0, "active": 0}


@register_command("refresh_pool")
async def stub_refresh_pool(params: dict) -> dict:
    """No-op refresh."""
    return {"ok": True}


@register_command("reload_pool")
async def stub_reload_pool(params: dict) -> dict:
    """No-op reload."""
    return {"ok": True}
