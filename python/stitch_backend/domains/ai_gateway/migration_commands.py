"""Command handler(s) for the one-time AI Gateway legacy-data migration.

Kept in its own file (separate from ``commands.py``) so this migration can
land independently of the CRUD-layer agent's command handlers without a
merge conflict on the same file.

This command is NOT wired into ``main.py``'s startup/lifespan — it is
intentionally manual-trigger-only (e.g. a button on a future settings page),
since it's a one-time backfill, not something that should run on every boot.
"""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_gateway.migration import migrate_legacy_credentials


@register_command("migrate_ai_gateway_legacy_data")
async def cmd_migrate_ai_gateway_legacy_data(params: dict) -> dict:
    """Backfill ``ai_gateway_provider_endpoints`` / ``credentials`` /
    ``credential_secrets`` from the legacy ``ai_proxy_accounts``,
    ``ai_proxy_settings`` (per-provider API keys), and ``custom_providers_v1``
    sources. Idempotent — safe to call more than once.

    ``params`` is unused (no arguments required) but accepted for consistency
    with the command dispatcher's calling convention.
    """

    async def _op(session):
        return await migrate_legacy_credentials(session)

    return await run_in_session(_op)
