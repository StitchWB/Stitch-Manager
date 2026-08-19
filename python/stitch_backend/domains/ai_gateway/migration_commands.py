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


@register_command("migrate_ai_gateway_legacy_data", admin_only=True)
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


# ── Gateway export / import (same payload schema as legacy ai_proxy export) ──


@register_command("gateway_export_payload", admin_only=True)
async def cmd_gateway_export_payload(params: dict) -> str:
    """Export ai_gateway credentials using the legacy ai_proxy payload schema.

    Produces the same JSON/CSV shape as ``export_ai_proxy_accounts_payload``
    so old frontend export files can be round-tripped through the gateway.
    """
    from stitch_backend.domains.ai_proxy.legacy_alias import export_payload

    fmt = params.get("format", "json")
    include_secrets = params.get("includeSecrets", params.get("include_secrets", False))

    async def _op(session):
        return await export_payload(session, fmt=fmt, include_secrets=include_secrets)

    return await run_in_session(_op)


@register_command("gateway_import_payload", admin_only=True)
async def cmd_gateway_import_payload(params: dict) -> int:
    """Import a legacy ai_proxy payload into ai_gateway tables.

    Consumes the same JSON payload schema as
    ``import_ai_proxy_accounts_payload`` so old FE export files import
    directly into the gateway.
    """
    import json

    from stitch_backend.domains.ai_proxy.legacy_alias import import_payload

    payload_str = params.get("payload", params.get("payloadStr", "{}"))
    if isinstance(payload_str, dict):
        payload_str = json.dumps(payload_str)

    async def _op(session):
        return await import_payload(session, payload_str)

    return await run_in_session(_op)
