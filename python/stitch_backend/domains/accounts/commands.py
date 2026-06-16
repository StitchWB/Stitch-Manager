"""Account command handlers — registered via ``@register_command``.

Each handler receives a ``dict`` (the JSON body from the frontend) and
returns a Pydantic model or a plain dict/list.  The dispatcher
(``cmd_dispatcher._serialise``) handles camelCase serialization centrally.

Session lifecycle is managed by :func:`stitch_backend.database.run_in_session`
which guarantees auto-commit on success and rollback on error.
"""

from __future__ import annotations

import logging
from typing import Any

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session
from stitch_backend.domains.accounts.schemas import (
    AddAccountRequest,
    ArchiveAccountRequest,
    BulkDeleteRequest,
    BulkExportRequest,
    DeleteAccountRequest,
    GetAccountQuotaRequest,
    ListAccountsRequest,
    RefreshAccountRequest,
    SetAccountProxyRequest,
    UpdateAccountMetadataRequest,
    UpdateAccountNotesTagsRequest,
    UpdateAccountTokenRequest,
)
from stitch_backend.domains.accounts.service import AccountService

logger = logging.getLogger(__name__)


# ── Helper ────────────────────────────────────────────────────────────────────

def _parse(model_cls, params: dict):
    """Instantiate a Pydantic model, tolerating camelCase *and* snake_case."""
    return model_cls.model_validate(params)


# ═════════════════════════════════════════════════════════════════════════════
# Commands
# ═════════════════════════════════════════════════════════════════════════════

@register_command("list_accounts")
async def cmd_list_accounts(params: dict) -> list:
    req = _parse(ListAccountsRequest, params)

    async def _op(session):
        svc = AccountService(session)
        return await svc.list_accounts(
            provider=req.provider,
            provider_type=req.provider_type,
            provider_subtype=req.provider_subtype,
            show_archived=req.show_archived,
        )

    return await run_in_session(_op)


@register_command("get_accounts")
async def cmd_get_accounts(params: dict) -> list:
    """Backward-compatible alias for ``list_accounts``."""
    return await cmd_list_accounts(params)


@register_command("add_account")
async def cmd_add_account(params: dict) -> Any:
    req = _parse(AddAccountRequest, params)

    async def _op(session):
        svc = AccountService(session)
        return await svc.add_account(req)

    return await run_in_session(_op)


@register_command("delete_account")
async def cmd_delete_account(params: dict) -> dict:
    req = _parse(DeleteAccountRequest, params)

    async def _op(session):
        svc = AccountService(session)
        await svc.delete_account(str(req.id))

    await run_in_session(_op)
    return {"success": True}


@register_command("update_account_token")
async def cmd_update_account_token(params: dict) -> Any:
    req = _parse(UpdateAccountTokenRequest, params)

    async def _op(session):
        svc = AccountService(session)
        return await svc.update_token(str(req.id), req.token, req.refresh_token)

    return await run_in_session(_op)


@register_command("update_account_notes_tags")
async def cmd_update_account_notes_tags(params: dict) -> Any:
    req = _parse(UpdateAccountNotesTagsRequest, params)

    async def _op(session):
        svc = AccountService(session)
        return await svc.update_notes_tags(str(req.id), req.notes, req.tags)

    return await run_in_session(_op)


@register_command("update_account_metadata")
async def cmd_update_account_metadata(params: dict) -> Any:
    req = _parse(UpdateAccountMetadataRequest, params)

    async def _op(session):
        svc = AccountService(session)
        return await svc.update_metadata(str(req.account_id), req.metadata)

    return await run_in_session(_op)


@register_command("set_account_proxy")
async def cmd_set_account_proxy(params: dict) -> Any:
    req = _parse(SetAccountProxyRequest, params)

    async def _op(session):
        svc = AccountService(session)
        return await svc.set_proxy(str(req.account_id), req.proxy_id)

    return await run_in_session(_op)


@register_command("get_account_proxy")
async def cmd_get_account_proxy(params: dict) -> dict:
    account_id = str(params.get("accountId") or params.get("id", ""))

    async def _op(session):
        svc = AccountService(session)
        return await svc.get_account(account_id)

    account = await run_in_session(_op)
    return {"accountId": account_id, "proxyId": account.proxy_id, "proxyConfig": account.proxy_config}


@register_command("refresh_account")
async def cmd_refresh_account(params: dict) -> dict:
    req = _parse(RefreshAccountRequest, params)

    async def _op(session):
        from datetime import datetime, timezone
        svc = AccountService(session)
        account = await svc.get_account(str(req.account_id))
        account.last_checked_at = datetime.now(timezone.utc)
        return account

    await run_in_session(_op)
    return {"success": True, "accountId": str(req.account_id)}


@register_command("get_account_quota")
async def cmd_get_account_quota(params: dict) -> dict:
    req = _parse(GetAccountQuotaRequest, params)
    # Phase 2 stub: return placeholder quota
    return {
        "accountId": str(req.account_id),
        "used": 0,
        "limit": 0,
        "remaining": 0,
    }


@register_command("archive_account")
async def cmd_archive_account(params: dict) -> Any:
    req = _parse(ArchiveAccountRequest, params)

    async def _op(session):
        svc = AccountService(session)
        return await svc.archive(str(req.id), req.archived)

    return await run_in_session(_op)


@register_command("validate_account")
async def cmd_validate_account(params: dict) -> dict:
    account_id = str(params.get("accountId") or params.get("id", ""))

    async def _op(session):
        svc = AccountService(session)
        return await svc.get_account(account_id)

    account = await run_in_session(_op)
    return {
        "valid": account.status == "active",
        "accountId": account_id,
        "status": account.status,
    }


# ── Bulk operations ──────────────────────────────────────────────────────────

@register_command("bulk_delete_accounts")
async def cmd_bulk_delete_accounts(params: dict) -> dict:
    req = _parse(BulkDeleteRequest, params)

    async def _op(session):
        svc = AccountService(session)
        return await svc.bulk_delete(req.ids)

    count = await run_in_session(_op)
    return {"deleted": count}


@register_command("bulk_export_accounts")
async def cmd_bulk_export_accounts(params: dict) -> list:
    req = _parse(BulkExportRequest, params)

    async def _op(session):
        svc = AccountService(session)
        return await svc.bulk_export(req.provider, req.ids)

    return await run_in_session(_op)


@register_command("bulk_refresh_quota")
async def cmd_bulk_refresh_quota(params: dict) -> dict:
    # Phase 2 stub
    return {"refreshed": 0}


# ── Additional accounts commands ────────────────────────────────────────────

@register_command("get_windsurf_token")
async def cmd_get_windsurf_token(params: dict) -> dict:
    """Get token for existing Windsurf account."""
    account_id = params.get("accountId", params.get("account_id", 0))
    return {
        "accountId": int(account_id),
        "status": "unknown",
        "message": "Windsurf token retrieval requires Codeium API login (not yet ported)",
        "token": None,
    }


@register_command("import_accounts_payload")
async def cmd_import_accounts_payload(params: dict) -> dict:
    """Import accounts from JSON payload with dedup."""
    import json as _json
    from sqlalchemy import text as sql_text

    accounts_json = params.get("accountsJson", params.get("accounts_json", ""))
    if not accounts_json:
        return {"imported": 0, "skipped": 0, "errors": ["Empty payload"]}

    try:
        payload = _json.loads(accounts_json) if isinstance(accounts_json, str) else accounts_json
    except _json.JSONDecodeError as e:
        return {"imported": 0, "skipped": 0, "errors": [f"Invalid JSON: {e}"]}

    accounts = payload if isinstance(payload, list) else payload.get("accounts", [])

    async def _op(session):
        imported = 0
        skipped = 0
        for acc in accounts:
            provider = acc.get("provider", "")
            email = acc.get("email", acc.get("name", ""))
            if not provider or not email:
                skipped += 1
                continue
            try:
                existing = await session.execute(
                    sql_text("SELECT id FROM accounts WHERE provider = :p AND email = :e"),
                    {"p": provider, "e": email},
                )
                if existing.fetchone():
                    skipped += 1
                    continue
                await session.execute(sql_text(
                    "INSERT INTO accounts (provider, email, token, status, tags, notes)"
                    " VALUES (:p, :e, :t, :s, :tags, :notes)"
                ), {
                    "p": provider,
                    "e": email,
                    "t": acc.get("token", ""),
                    "s": acc.get("status", "active"),
                    "tags": acc.get("tags", ""),
                    "notes": acc.get("notes", ""),
                })
                imported += 1
            except Exception:
                skipped += 1
        return {"imported": imported, "skipped": skipped}

    return await run_in_session(_op)
