"""API Keys command handlers — thin adapters around ApiKeysService.

Each command maps to the corresponding Rust Tauri command.
"""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_get_cmd(provider: str):
    """Create a ``get_*_api_keys`` handler for a provider."""

    async def handler(params: dict) -> list:
        async def _op(session):
            from stitch_backend.domains.api_keys.service import ApiKeysService

            svc = ApiKeysService(session)
            return await svc.get_keys(provider)

        return await run_in_session(_op)

    return handler


def _make_set_cmd(provider: str):
    """Create a ``set_*_api_keys`` handler for a provider."""

    async def handler(params: dict) -> dict:
        keys = params.get("keys", [])
        if not isinstance(keys, list):
            keys = []

        async def _op(session):
            from stitch_backend.domains.api_keys.service import ApiKeysService

            svc = ApiKeysService(session)
            await svc.set_keys(provider, keys)
            return {"success": True}

        return await run_in_session(_op)

    return handler


# ── Register all 10 commands ─────────────────────────────────────────────────

_PROVIDERS = ["gemini", "openai", "anthropic", "antigravity", "fireworks"]

for _p in _PROVIDERS:
    register_command(f"get_{_p}_api_keys")(_make_get_cmd(_p))
    register_command(f"set_{_p}_api_keys")(_make_set_cmd(_p))
