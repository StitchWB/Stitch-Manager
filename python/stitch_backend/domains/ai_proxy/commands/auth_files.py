"""Auth-file scan & auto-import commands."""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session
from stitch_backend.domains.ai_proxy.commands._common import _alias_owner_id


@register_command("scan_auth_files")
async def cmd_scan_auth_files(params: dict) -> list:
    from stitch_backend.domains.ai_proxy.service import AuthFileScanner
    from stitch_backend.domains.auth.permissions import ensure_permission

    await ensure_permission(params, "action.export_accounts")

    files = AuthFileScanner.scan_all()
    return [
        {"provider": f.provider, "path": f.path, "token": f.token[:8] + "...", "expiresAt": f.expires_at}
        for f in files
    ]


@register_command("auto_import_ai_proxy_auth_files")
async def cmd_auto_import_ai_proxy_auth_files(params: dict) -> dict:
    """Scan and auto-import discovered auth files into accounts."""
    from stitch_backend.domains.ai_proxy.legacy_accounts_api import (
        create_account,
        get_account_by_name,
    )
    from stitch_backend.domains.ai_proxy.service import AuthFileScanner
    from stitch_backend.domains.auth.permissions import ensure_permission

    await ensure_permission(params, "action.export_accounts")

    files = AuthFileScanner.scan_all()
    owner_id = _alias_owner_id(params)

    async def _op(session):
        imported = 0
        for f in files:
            name = f.path.split("/")[-1].replace(".json", "")
            existing = await get_account_by_name(session, f.provider, name)
            if existing:
                continue
            account = {
                "provider": f.provider,
                "name": name,
                "apiKey": f.token,
                "enabled": True,
            }
            await create_account(session, account, owner_id=owner_id)
            imported += 1
        return imported

    imported = await run_in_session(_op)
    return {"scanned": len(files), "imported": imported}
