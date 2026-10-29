"""Outlook mailbox pool command handlers."""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

import httpx

from stitch_backend.core.command_registry import register_command

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

PROVIDER_ID = "outlook"
REFRESHED_TAG_PREFIX = "rt_refreshed_at="
REFRESH_MAX_AGE_SECONDS = 30 * 24 * 3600
_CANDIDATE_LIMIT = 200
_BATCH_LIMIT = 50
_CALL_TIMEOUT_SECONDS = 15.0

_GRAPH_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
_GRAPH_CLIENT_ID = "9e5f94bc-e8a4-4e73-b8be-63364c29d753"


def _graph_constants() -> tuple[str, str]:
    try:
        from autoreg.providers.outlook.config import CLIENT_ID, TOKEN_URL
        return TOKEN_URL, CLIENT_ID
    except ImportError:
        return _GRAPH_TOKEN_URL, _GRAPH_CLIENT_ID


def _outbound_proxy() -> str | None:
    try:
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
        return _get_outbound_proxy()
    except Exception:
        return None


def _is_stale(tags: list | None) -> bool:
    for tag in tags or []:
        if isinstance(tag, str) and tag.startswith(REFRESHED_TAG_PREFIX):
            try:
                refreshed_at = int(tag[len(REFRESHED_TAG_PREFIX):])
            except ValueError:
                return True
            return (time.time() - refreshed_at) > REFRESH_MAX_AGE_SECONDS
    return True


async def _load_candidates(session: AsyncSession) -> list[dict[str, Any]]:
    from sqlalchemy import select

    from stitch_backend.domains.accounts.models import Account

    stmt = (
        select(
            Account.id, Account.tags, Account.token, Account.api_key,
            Account.refresh_token, Account.provider_metadata,
        )
        .where(Account.provider == PROVIDER_ID, Account.status == "active")
        .order_by(Account.created_at.asc())
        .limit(_CANDIDATE_LIMIT)
    )
    rows = await session.execute(stmt)
    return [
        {
            "id": str(row.id),
            "tags": row.tags or [],
            "refresh_token": row.token or row.api_key or row.refresh_token,
            "provider_metadata": row.provider_metadata or {},
        }
        for row in rows
    ]


def _error_detail(resp: httpx.Response) -> tuple[str, str]:
    try:
        body = resp.json()
    except Exception:
        return "", resp.text[:200]
    parts = [str(body.get(k)) for k in ("error", "error_description") if body.get(k)]
    return str(body.get("error") or ""), " ".join(parts) or resp.text[:200]


async def _refresh_one(
    token_url: str, refresh_token: str, client_id: str, proxy: str | None,
) -> dict[str, Any]:
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }
    try:
        async with httpx.AsyncClient(timeout=_CALL_TIMEOUT_SECONDS, proxy=proxy) as client:
            resp = await client.post(token_url, data=payload)
    except Exception as exc:
        return {"success": False, "error": str(exc)}

    if resp.status_code == 200:
        try:
            data = resp.json()
        except Exception:
            return {"success": False, "error": "token response is not JSON"}
        if not data.get("refresh_token"):
            return {"success": False, "error": "token response missing refresh_token"}
        return {
            "success": True,
            "access_token": data.get("access_token"),
            "refresh_token": data.get("refresh_token"),
        }

    error_code, detail = _error_detail(resp)
    out: dict[str, Any] = {"success": False, "error": f"HTTP {resp.status_code}: {detail}"}
    if error_code == "invalid_grant":
        out["invalid_grant"] = True
    return out


async def _write_back(account_id: str, result: dict[str, Any]) -> None:
    from stitch_backend.database import run_in_session
    from stitch_backend.domains.accounts.service import AccountService

    new_refresh = str(result.get("refresh_token") or "")
    now_tag = f"{REFRESHED_TAG_PREFIX}{int(time.time())}"

    async def _op(db: AsyncSession) -> None:
        svc = AccountService(db)
        await svc.update_token(account_id, new_refresh, new_refresh)
        account = await svc.get_account(account_id)
        account.tags = [
            t for t in (account.tags or [])
            if not (isinstance(t, str) and t.startswith(REFRESHED_TAG_PREFIX))
        ] + [now_tag]
        await db.flush()

    try:
        await run_in_session(_op)
    except Exception as exc:
        logger.error("[outlook-pool] refresh write-back failed for %s: %s", account_id, exc)


async def _mark_expired(account_id: str, error: str) -> None:
    from stitch_backend.domains.outlook_mailbox_pool.service import (
        get_outlook_mailbox_pool_service,
    )

    try:
        await get_outlook_mailbox_pool_service().mark_unusable_async(account_id, error)
    except Exception as exc:
        logger.error("[outlook-pool] mark-unusable failed for %s: %s", account_id, exc)


async def _current_refresh_token(account_id: str) -> str | None:
    from sqlalchemy import select

    from stitch_backend.database import run_in_read_session
    from stitch_backend.domains.accounts.models import Account

    async def _read(session: AsyncSession) -> str | None:
        row = (
            await session.execute(
                select(Account.token, Account.api_key, Account.refresh_token).where(
                    Account.id == account_id
                )
            )
        ).first()
        if row is None:
            return None
        current: str | None = row.token or row.api_key or row.refresh_token
        return current

    return await run_in_read_session(_read)


@register_command("refresh_outlook_pool")
async def cmd_refresh_outlook_pool(params: dict) -> dict:
    """Refresh stale Graph refresh tokens for the outlook mailbox pool.

    Iterates active outlook accounts whose last refresh is older than
    ``REFRESH_MAX_AGE_SECONDS`` (tag ``rt_refreshed_at=<epoch>``) or never
    refreshed; writes new tokens back and retires ``invalid_grant`` rows.
    """
    provider = str(params.get("provider") or PROVIDER_ID)
    if provider != PROVIDER_ID:
        return {"success": False, "error": f"unsupported provider: {provider}"}

    from stitch_backend.database import run_in_read_session

    token_url, default_client_id = _graph_constants()
    proxy = _outbound_proxy()
    candidates = await run_in_read_session(_load_candidates)
    stale = [c for c in candidates if _is_stale(c["tags"])][:_BATCH_LIMIT]

    checked = ok = expired = skipped = failed = 0
    for row in stale:
        checked += 1
        refresh_token = row["refresh_token"]
        if not refresh_token:
            failed += 1
            continue
        client_id = str(row["provider_metadata"].get("client_id") or "") or default_client_id
        result = await _refresh_one(token_url, str(refresh_token), client_id, proxy)
        if result.get("success"):
            ok += 1
            await _write_back(row["id"], result)
        elif result.get("invalid_grant"):
            # a changed row token means another writer rotated it — not death
            current = await _current_refresh_token(row["id"])
            if current is not None and current != str(refresh_token):
                skipped += 1
                logger.info(
                    "[outlook-pool] %s rotated by another writer — skip expiry",
                    row["id"],
                )
            else:
                expired += 1
                await _mark_expired(row["id"], str(result.get("error") or "invalid_grant"))
        else:
            failed += 1
            logger.warning(
                "[outlook-pool] refresh failed for %s: %s", row["id"], result.get("error")
            )

    tally = f"checked={checked} ok={ok} expired={expired} skipped={skipped} failed={failed}"
    return {
        "success": failed == 0,
        "provider": PROVIDER_ID,
        "result": tally,
        "checked": checked,
        "ok": ok,
        "expired": expired,
        "skipped": skipped,
        "failed": failed,
    }
