"""Account command handlers — registered via ``@register_command``.

Each handler receives a ``dict`` (the JSON body from the frontend) and
returns a Pydantic model or a plain dict/list.  The dispatcher
(``cmd_dispatcher._serialise``) handles camelCase serialization centrally.

Session lifecycle is managed by :func:`stitch_backend.database.run_in_session`
which guarantees auto-commit on success and rollback on error.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any, cast

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.event_bus import event_bus
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.accounts.schemas import (
    AddAccountRequest,
    ArchiveAccountRequest,
    BulkDeleteRequest,
    BulkExportRequest,
    CheckKiroAccountRequest,
    DeleteAccountRequest,
    GetAccountQuotaRequest,
    ListAccountsRequest,
    RefreshAccountRequest,
    RefreshAccountsRequest,
    RefreshKiroTokenRequest,
    SetAccountProxyRequest,
    UpdateAccountMetadataRequest,
    UpdateAccountNotesTagsRequest,
    UpdateAccountTokenRequest,
)
from stitch_backend.domains.accounts.service import AccountService
from stitch_backend.domains.auth.permissions import ensure_permission

logger = logging.getLogger(__name__)


# ── Helper ────────────────────────────────────────────────────────────────────

def _now_iso_str() -> str:
    return datetime.now(UTC).isoformat()


def _parse(model_cls, params: dict):
    """Instantiate a Pydantic model, tolerating camelCase *and* snake_case."""
    return model_cls.model_validate(params)


# ═════════════════════════════════════════════════════════════════════════════
# Commands
# ═════════════════════════════════════════════════════════════════════════════

@register_command("list_accounts", readonly=True)
async def cmd_list_accounts(params: dict) -> list:
    req = _parse(ListAccountsRequest, params)
    owner_id = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        return await svc.list_accounts(
            provider=req.provider,
            provider_type=req.provider_type,
            provider_subtype=req.provider_subtype,
            show_archived=req.show_archived,
            owner_id=owner_id,
            caller_uid=owner_id,
        )

    return await run_in_read_session(_op)


@register_command("get_accounts", readonly=True)
async def cmd_get_accounts(params: dict) -> list:
    """Backward-compatible alias for ``list_accounts``."""
    return cast("list[Any]", await cmd_list_accounts(params))


@register_command("add_account")
async def cmd_add_account(params: dict) -> Any:
    req = _parse(AddAccountRequest, params)
    owner_id = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        return await svc.add_account(req, owner_id=owner_id)

    return await run_in_session(_op)


@register_command("delete_account")
async def cmd_delete_account(params: dict) -> dict:
    req = _parse(DeleteAccountRequest, params)
    caller_uid = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        await svc.delete_account(str(req.id), caller_uid=caller_uid)

    await run_in_session(_op)
    return {"success": True}


@register_command("update_account_token")
async def cmd_update_account_token(params: dict) -> Any:
    req = _parse(UpdateAccountTokenRequest, params)
    caller_uid = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        return await svc.update_token(
            str(req.id), req.token, req.refresh_token, caller_uid=caller_uid,
        )

    return await run_in_session(_op)


@register_command("update_account_notes_tags")
async def cmd_update_account_notes_tags(params: dict) -> Any:
    req = _parse(UpdateAccountNotesTagsRequest, params)
    caller_uid = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        return await svc.update_notes_tags(
            str(req.id), req.notes, req.tags, caller_uid=caller_uid,
        )

    return await run_in_session(_op)


@register_command("update_account_metadata")
async def cmd_update_account_metadata(params: dict) -> Any:
    req = _parse(UpdateAccountMetadataRequest, params)
    caller_uid = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        return await svc.update_metadata(
            str(req.account_id), req.metadata, caller_uid=caller_uid,
        )

    return await run_in_session(_op)


@register_command("set_account_proxy")
async def cmd_set_account_proxy(params: dict) -> Any:
    req = _parse(SetAccountProxyRequest, params)
    caller_uid = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        return await svc.set_proxy(
            str(req.account_id), req.proxy_id, caller_uid=caller_uid,
        )

    return await run_in_session(_op)


@register_command("get_account_proxy", readonly=True)
async def cmd_get_account_proxy(params: dict) -> dict:
    account_id = str(params.get("accountId") or params.get("id", ""))
    caller_uid = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        account = await svc.get_account(account_id)
        svc._check_ownership(account, caller_uid, account_id)
        return account

    account = await run_in_read_session(_op)
    return {"accountId": account_id, "proxyId": account.proxy_id, "proxyConfig": account.proxy_config}


@register_command("refresh_account")
async def cmd_refresh_account(params: dict) -> Any:
    """Run a real provider status/quota check and return the updated account.

    Delegates to ``AccountService.refresh_account`` which calls the
    account_status service for provider-dispatched quota fetching.  On
    network failure, falls back to a timestamp-only update.
    Returns the updated account serialized as AccountResponse so the
    frontend store can replace the row.
    """
    req = _parse(RefreshAccountRequest, params)
    caller_uid = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        return await svc.refresh_account(str(req.account_id), caller_uid=caller_uid)

    return await run_in_session(_op)


@register_command("refresh_accounts", timeout=300)
async def cmd_refresh_accounts(params: dict) -> dict:
    """Batch-refresh quota/status for multiple accounts with bounded concurrency.

    Processes up to 4 accounts concurrently via ``asyncio.Semaphore(4)``,
    reusing the same per-account refresh logic as ``refresh_account``
    (``AccountService.refresh_account``).  Each account gets its own DB
    session via ``run_in_session``, so a single slow account cannot block
    the single-writer pool for others.

    Emits ``accounts.refresh_progress`` events after each account completes
    so the frontend can update progress indicators live.

    Request:  ``{ accountIds: number[] }`` (non-empty, max 200).
    Response: ``{ total, updated, failed,
                  results: [{accountId, ok, account?, error?}] }``
    """
    req = _parse(RefreshAccountsRequest, params)
    account_ids = [str(aid) for aid in req.account_ids]
    total = len(account_ids)
    caller_uid = params.get("_caller_user_id")

    sem = asyncio.Semaphore(4)
    updated = 0
    failed = 0
    done = 0

    async def _refresh_one(account_id: str) -> dict:
        nonlocal updated, failed, done
        async with sem:
            try:
                async def _op(session):
                    svc = AccountService(session)
                    return await svc.refresh_account(
                        account_id, caller_uid=caller_uid,
                    )

                account = await run_in_session(_op)
                serialized = account.model_dump(mode="json", by_alias=True)
                updated += 1
                done += 1
                await event_bus.emit(
                    "accounts.refresh_progress",
                    {
                        "accountId": account_id,
                        "done": done,
                        "total": total,
                        "ok": True,
                    },
                )
                return {
                    "accountId": account_id,
                    "ok": True,
                    "account": serialized,
                }
            except Exception as exc:
                failed += 1
                done += 1
                logger.warning(
                    "refresh_accounts: failed for account %s: %s",
                    account_id, exc,
                )
                await event_bus.emit(
                    "accounts.refresh_progress",
                    {
                        "accountId": account_id,
                        "done": done,
                        "total": total,
                        "ok": False,
                        "error": str(exc),
                    },
                )
                return {
                    "accountId": account_id,
                    "ok": False,
                    "error": str(exc),
                }

    results = await asyncio.gather(
        *[_refresh_one(aid) for aid in account_ids]
    )
    return {
        "total": total,
        "updated": updated,
        "failed": failed,
        "results": list(results),
    }


@register_command("get_account_quota", readonly=True)
async def cmd_get_account_quota(params: dict) -> dict:
    """Return persisted quota for an account (no live fetch).

    Reads ``quota_used``, ``quota_limit``, ``quota_checked_at`` from the
    accounts table.  Use ``refresh_account`` to trigger a live fetch.
    """
    req = _parse(GetAccountQuotaRequest, params)
    caller_uid = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        account = await svc.get_account(str(req.account_id))
        svc._check_ownership(account, caller_uid, str(req.account_id))
        used = account.quota_used or 0
        limit = account.quota_limit or 0
        checked_at = (
            account.quota_checked_at.isoformat()
            if account.quota_checked_at
            else None
        )
        return {
            "accountId": str(req.account_id),
            "used": used,
            "limit": limit,
            "remaining": max(0, limit - used) if limit > 0 else 0,
            "checkedAt": checked_at,
        }

    return await run_in_read_session(_op)


@register_command("archive_account")
async def cmd_archive_account(params: dict) -> Any:
    req = _parse(ArchiveAccountRequest, params)
    caller_uid = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        return await svc.archive(str(req.id), req.archived, caller_uid=caller_uid)

    return await run_in_session(_op)


@register_command("validate_account", readonly=True)
async def cmd_validate_account(params: dict) -> bool:
    """Validate account exists and is active (returns bool)."""
    account_id = str(params.get("accountId") or params.get("id", ""))
    caller_uid = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        account = await svc.get_account(account_id)
        svc._check_ownership(account, caller_uid, account_id)
        return account

    account = await run_in_read_session(_op)
    return cast("bool", account.status == "active")


# ── Bulk operations ──────────────────────────────────────────────────────────

@register_command("bulk_delete_accounts")
async def cmd_bulk_delete_accounts(params: dict) -> dict:
    await ensure_permission(params, "action.bulk_delete")
    req = _parse(BulkDeleteRequest, params)
    caller_uid = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        return await svc.bulk_delete(req.ids, caller_uid=caller_uid)

    count = await run_in_session(_op)
    return {"deleted": count}


@register_command("bulk_export_accounts", readonly=True)
async def cmd_bulk_export_accounts(params: dict) -> list:
    await ensure_permission(params, "action.export_accounts")
    req = _parse(BulkExportRequest, params)
    owner_id = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        return await svc.bulk_export(req.provider, req.ids, owner_id=owner_id)

    return await run_in_read_session(_op)


@register_command("bulk_refresh_quota")
async def cmd_bulk_refresh_quota(params: dict) -> dict:
    """Refresh quota for all accounts that have tokens, with bounded concurrency.

    Iterates all non-archived accounts with a non-null ``token``, runs the
    provider status/quota check via ``AccountService.refresh_account`` with
    an asyncio.Semaphore(5) to bound concurrency, and returns the count of
    successfully refreshed accounts.
    """
    await ensure_permission(params, "action.export_accounts")

    from sqlalchemy import or_, select

    from stitch_backend.database import get_session_factory
    from stitch_backend.domains.accounts.models import Account

    caller_uid = params.get("_caller_user_id")
    factory = get_session_factory()
    async with factory() as session:
        stmt = (
            select(Account.id)
            .where(Account.token.isnot(None))
            .where(Account.token != "")
            .where(Account.status != "archived")
        )
        if caller_uid is not None:
            # Per-user isolation: shared (NULL) or own rows only.
            stmt = stmt.where(
                or_(Account.owner_id.is_(None), Account.owner_id == caller_uid)
            )
        result = await session.execute(stmt)
        account_ids = [str(row[0]) for row in result.fetchall()]

    if not account_ids:
        return {"refreshed": 0}

    sem = asyncio.Semaphore(5)
    refreshed = 0

    async def _refresh_one(account_id: str) -> bool:
        nonlocal refreshed
        async with sem:
            async def _op(session):
                svc = AccountService(session)
                await svc.refresh_account(account_id, caller_uid=caller_uid)
                return True

            try:
                await run_in_session(_op)
                refreshed += 1
                return True
            except Exception as exc:
                logger.warning(
                    "bulk_refresh_quota: failed for account %s: %s",
                    account_id, exc,
                )
                return False

    await asyncio.gather(*[_refresh_one(aid) for aid in account_ids])
    return {"refreshed": refreshed}


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
    await ensure_permission(params, "action.export_accounts")

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
    owner_id = params.get("_caller_user_id")

    async def _op(session):
        imported = 0
        skipped = 0
        errors: list[str] = []
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
                import uuid as _uuid
                tags_val = acc.get("tags")
                await session.execute(sql_text(
                    "INSERT INTO accounts "
                    "(id, provider, email, token, status, tags, notes, owner_id, "
                    " use_count, success_rate, quota_used, quota_limit, "
                    " login_count, error_count, ref_used_count, ref_max_count, "
                    " created_at) "
                    "VALUES (:id, :p, :e, :t, :s, :tags, :notes, :owner_id, "
                    " 0, 1.0, 0, 0, 0, 0, 0, 40, :created_at)"
                ), {
                    "id": str(_uuid.uuid4()),
                    "p": provider,
                    "e": email,
                    "t": acc.get("token", ""),
                    "s": acc.get("status", "active"),
                    "tags": tags_val if tags_val else None,
                    "notes": acc.get("notes", ""),
                    "owner_id": owner_id,
                    "created_at": _now_iso_str(),
                })
                imported += 1
            except Exception as exc:
                skipped += 1
                # Diagnostic per failed row — never include token/secret
                # values in the error string (only provider + email).
                # Truncate to first line: SQLAlchemy/SQLite errors include
                # the full SQL parameters (which may contain the token) on
                # subsequent lines — the first line is the safe summary.
                exc_short = str(exc).split("\n")[0][:200]
                diag = f"{provider}/{email}: {exc_short}"
                errors.append(diag)
                logger.warning("import_accounts_payload row failed: %s", diag)
        return {"imported": imported, "skipped": skipped, "errors": errors}

    return await run_in_session(_op)


# ── Admin owner assignment ────────────────────────────────────────────────────


@register_command("accounts_assign_owner", admin_only=True)
async def cmd_accounts_assign_owner(params: dict) -> dict:
    """Assign or clear the owner of an account (admin only).

    ``assignToUserId`` sets ``owner_id`` to that user (explicit ownership).
    ``null`` (or omitted) sets ``owner_id = NULL`` (instance-shared).
    """
    from sqlalchemy import select as sa_select

    from stitch_backend.core.exceptions import StitchError
    from stitch_backend.domains.accounts.models import Account

    account_id = str(params.get("id") or params.get("accountId") or "")
    if not account_id:
        raise StitchError("id is required")
    assign_to = params.get("assignToUserId")
    if assign_to is not None:
        assign_to = int(assign_to)

    async def _op(session):
        result = await session.execute(
            sa_select(Account).where(Account.id == account_id)
        )
        account = result.scalar_one_or_none()
        if account is None:
            raise StitchError(f"Account not found: {account_id}")
        account.owner_id = assign_to
        await session.flush()
        return True

    await run_in_session(_op)
    return {"success": True}


# ── Kiro token management ─────────────────────────────────────────────────────


@register_command("refresh_kiro_token")
async def cmd_refresh_kiro_token(params: dict) -> dict:
    """Refresh the OAuth access token for a Kiro account.

    Uses ``provider_metadata.client_id`` + ``client_secret`` when available
    (v2/v3 registration flow); falls back to the legacy clientIdHash for older
    accounts.  Persists the new token + expiry to the DB.

    Request: ``{ accountId, proxy?, force? }``
    Response: ``{ success, refreshed, expires_at, account?, error? }``
    """
    req = _parse(RefreshKiroTokenRequest, params)
    caller_uid = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        return await svc.refresh_kiro_token(
            str(req.account_id),
            proxy=req.proxy,
            force=req.force,
            caller_uid=caller_uid,
        )

    return await run_in_session(_op)


@register_command("check_kiro_account")
async def cmd_check_kiro_account(params: dict) -> dict:
    """Verify a Kiro account is alive and fetch credit / subscription info.

    Calls GET /getUsageLimits.  Automatically attempts a token refresh when
    the access token appears expired (``autoRefresh=true`` by default).

    Request: ``{ accountId, proxy?, autoRefresh? }``
    Response: ``{ alive, suspended, email, subscription, credit_used,
                  credit_limit, credit_remaining, region, error, checked_at, account }``
    """
    req = _parse(CheckKiroAccountRequest, params)
    caller_uid = params.get("_caller_user_id")

    async def _op(session):
        svc = AccountService(session)
        return await svc.check_kiro_account(
            str(req.account_id),
            proxy=req.proxy,
            auto_refresh=req.auto_refresh,
            caller_uid=caller_uid,
        )

    return await run_in_session(_op)


# ── Claim ─────────────────────────────────────────────────────────────────────


@register_command("claim_account")
async def cmd_claim_account(params: dict) -> Any:
    """Claim a shared (owner_id NULL) account for the caller.

    Sets ``owner_id = caller uid`` ONLY when the current owner_id is
    NULL.  Caller must be authenticated (uid not None) else 400.
    """
    await ensure_permission(params, "action.claim")
    uid = params.get("_caller_user_id")
    if uid is None:
        raise ValueError("Authentication required to claim a shared account")
    account_id = str(params.get("id") or params.get("accountId") or "")

    async def _op(session):
        from sqlalchemy import select as sa_select

        from stitch_backend.domains.accounts.models import Account
        result = await session.execute(
            sa_select(Account).where(Account.id == account_id)
        )
        account = result.scalar_one_or_none()
        if account is None:
            raise ValueError(f"Account not found: {account_id}")
        if account.owner_id is not None:
            raise ValueError("not shared")
        account.owner_id = uid
        await session.flush()
        svc = AccountService(session)
        return svc.get_account_response(account_id)

    return await run_in_session(_op)



