"""CRUD operations on the ``ai_proxy_accounts`` table (flat table, raw SQL)."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import text


def _now_ts() -> int:
    return int(time.time())


def _row_to_account(row: Any) -> dict[str, Any]:
    """Convert a SQLAlchemy Row to an AiProxyAccount dict (camelCase).

    Uses ``getattr`` with defaults for all optional columns so the function
    works even if the table was created by an older version with fewer columns.
    """
    return {
        "id": row.id,
        "provider": row.provider,
        "name": row.name,
        "oauthToken": getattr(row, "oauth_token", None),
        "apiKey": getattr(row, "api_key", None),
        "sessionToken": getattr(row, "session_token", None),
        "enabled": bool(getattr(row, "enabled", 1)),
        "accountType": getattr(row, "account_type", None),
        "requestsToday": getattr(row, "requests_today", 0) or 0,
        "requestsTotal": getattr(row, "requests_total", 0) or 0,
        "tokensUsed": getattr(row, "tokens_used", 0) or 0,
        "lastUsedAt": getattr(row, "last_used_at", None),
        "softQuotaTokensDaily": getattr(row, "soft_quota_tokens_daily", None),
        "softQuotaRequestsDaily": getattr(row, "soft_quota_requests_daily", None),
        "createdAt": getattr(row, "created_at", None),
        "updatedAt": getattr(row, "updated_at", None),
        "oauthRefreshToken": getattr(row, "oauth_refresh_token", None),
        "oauthExpiresAt": getattr(row, "oauth_expires_at", None),
        "oauthScopes": getattr(row, "oauth_scopes", None),
        "oauthTokenType": getattr(row, "oauth_token_type", None),
        "refCode": getattr(row, "ref_code", None),
        "refUrl": getattr(row, "ref_url", None),
        "refUsedCount": getattr(row, "ref_used_count", 0) or 0,
        "refMaxCount": getattr(row, "ref_max_count", 40) or 40,
        "referredById": getattr(row, "referred_by_id", None),
    }


class AiProxyAccountStore:
    """CRUD operations on ``ai_proxy_accounts`` table."""

    _TABLE_ENSUREED = False

    @classmethod
    async def _ensure_table(cls, session: Any) -> None:
        if cls._TABLE_ENSUREED:
            return
        await session.execute(text(
            "CREATE TABLE IF NOT EXISTS ai_proxy_accounts ("
            "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "  provider TEXT NOT NULL,"
            "  name TEXT NOT NULL,"
            "  oauth_token TEXT,"
            "  api_key TEXT,"
            "  session_token TEXT,"
            "  enabled INTEGER NOT NULL DEFAULT 1,"
            "  account_type TEXT,"
            "  requests_today INTEGER NOT NULL DEFAULT 0,"
            "  requests_total INTEGER NOT NULL DEFAULT 0,"
            "  tokens_used INTEGER NOT NULL DEFAULT 0,"
            "  last_used_at INTEGER,"
            "  soft_quota_tokens_daily INTEGER,"
            "  soft_quota_requests_daily INTEGER,"
            "  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),"
            "  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),"
            "  oauth_refresh_token TEXT,"
            "  oauth_expires_at INTEGER,"
            "  oauth_scopes TEXT,"
            "  oauth_token_type TEXT DEFAULT 'Bearer',"
            "  oauth_refresh_error TEXT,"
            "  oauth_last_refresh_attempt_at INTEGER,"
            "  oauth_last_refresh_success_at INTEGER,"
            "  cooldown_until INTEGER,"
            "  cooldown_reason TEXT,"
            "  UNIQUE(provider, name)"
            ")"
        ))
        # tables created by older versions may lack these columns
        _migrate_columns = [
            ("oauth_refresh_token", "TEXT"),
            ("oauth_expires_at", "INTEGER"),
            ("oauth_scopes", "TEXT"),
            ("oauth_token_type", "TEXT DEFAULT 'Bearer'"),
            ("oauth_refresh_error", "TEXT"),
            ("oauth_last_refresh_attempt_at", "INTEGER"),
            ("oauth_last_refresh_success_at", "INTEGER"),
            ("cooldown_until", "INTEGER"),
            ("cooldown_reason", "TEXT"),
            ("soft_quota_tokens_daily", "INTEGER"),
            ("soft_quota_requests_daily", "INTEGER"),
            ("ref_code", "TEXT"),
            ("ref_url", "TEXT"),
            ("ref_used_count", "INTEGER NOT NULL DEFAULT 0"),
            ("ref_max_count", "INTEGER NOT NULL DEFAULT 40"),
            ("referred_by_id", "INTEGER"),
        ]
        for col_name, col_type in _migrate_columns:
            try:
                await session.execute(
                    text(f"ALTER TABLE ai_proxy_accounts ADD COLUMN {col_name} {col_type}")
                )
            except Exception:
                pass  # column already exists
        cls._TABLE_ENSUREED = True

    @classmethod
    async def get_accounts(cls, session: Any) -> list[dict[str, Any]]:
        await cls._ensure_table(session)
        result = await session.execute(
            text("SELECT * FROM ai_proxy_accounts ORDER BY provider, name")
        )
        return [_row_to_account(row) for row in result.fetchall()]

    @classmethod
    async def create_account(cls, session: Any, account: dict[str, Any]) -> int:
        await cls._ensure_table(session)
        now = _now_ts()
        result = await session.execute(text(
            "INSERT INTO ai_proxy_accounts "
            "(provider, name, oauth_token, api_key, session_token, enabled, account_type,"
            " soft_quota_tokens_daily, soft_quota_requests_daily, created_at, updated_at,"
            " oauth_refresh_token, oauth_expires_at, oauth_scopes, oauth_token_type,"
            " ref_code, ref_url, ref_used_count, ref_max_count, referred_by_id)"
            " VALUES (:provider, :name, :oauth_token, :api_key, :session_token,"
            " :enabled, :account_type, :soft_quota_tokens_daily, :soft_quota_requests_daily,"
            " :created_at, :updated_at, :oauth_refresh_token, :oauth_expires_at,"
            " :oauth_scopes, :oauth_token_type,"
            " :ref_code, :ref_url, :ref_used_count, :ref_max_count, :referred_by_id)"
        ), {
            "provider": account.get("provider", ""),
            "name": account.get("name", ""),
            "oauth_token": account.get("oauth_token") or account.get("oauthToken"),
            "api_key": account.get("api_key") or account.get("apiKey"),
            "session_token": account.get("session_token") or account.get("sessionToken"),
            "enabled": 1 if account.get("enabled", True) else 0,
            "account_type": account.get("account_type") or account.get("accountType"),
            "soft_quota_tokens_daily": account.get("soft_quota_tokens_daily") or account.get("softQuotaTokensDaily"),
            "soft_quota_requests_daily": account.get("soft_quota_requests_daily") or account.get("softQuotaRequestsDaily"),
            "created_at": account.get("created_at") or account.get("createdAt") or now,
            "updated_at": account.get("updated_at") or account.get("updatedAt") or now,
            "oauth_refresh_token": account.get("oauth_refresh_token") or account.get("oauthRefreshToken"),
            "oauth_expires_at": account.get("oauth_expires_at") or account.get("oauthExpiresAt"),
            "oauth_scopes": account.get("oauth_scopes") or account.get("oauthScopes"),
            "oauth_token_type": account.get("oauth_token_type") or account.get("oauthTokenType") or "Bearer",
            "ref_code": account.get("ref_code") or account.get("refCode"),
            "ref_url": account.get("ref_url") or account.get("refUrl"),
            "ref_used_count": account.get("ref_used_count") or account.get("refUsedCount") or 0,
            "ref_max_count": account.get("ref_max_count") or account.get("refMaxCount") or 40,
            "referred_by_id": account.get("referred_by_id") or account.get("referredById"),
        })
        return result.lastrowid or 0

    @classmethod
    async def update_account(cls, session: Any, account: dict[str, Any]) -> None:
        await cls._ensure_table(session)
        await session.execute(text(
            "UPDATE ai_proxy_accounts SET"
            " provider=:provider, name=:name, oauth_token=:oauth_token,"
            " api_key=:api_key, session_token=:session_token, enabled=:enabled,"
            " account_type=:account_type,"
            " soft_quota_tokens_daily=:soft_quota_tokens_daily,"
            " soft_quota_requests_daily=:soft_quota_requests_daily,"
            " updated_at=:updated_at"
            " WHERE id=:id"
        ), {
            "id": account.get("id"),
            "provider": account.get("provider", ""),
            "name": account.get("name", ""),
            "oauth_token": account.get("oauth_token") or account.get("oauthToken"),
            "api_key": account.get("api_key") or account.get("apiKey"),
            "session_token": account.get("session_token") or account.get("sessionToken"),
            "enabled": 1 if account.get("enabled", True) else 0,
            "account_type": account.get("account_type") or account.get("accountType"),
            "soft_quota_tokens_daily": account.get("soft_quota_tokens_daily") or account.get("softQuotaTokensDaily"),
            "soft_quota_requests_daily": account.get("soft_quota_requests_daily") or account.get("softQuotaRequestsDaily"),
            "updated_at": _now_ts(),
        })

    @classmethod
    async def delete_account(cls, session: Any, account_id: int) -> None:
        await cls._ensure_table(session)
        await session.execute(
            text("DELETE FROM ai_proxy_accounts WHERE id=:id"),
            {"id": account_id},
        )

    @classmethod
    async def get_account_by_name(
        cls, session: Any, provider: str, name: str
    ) -> dict[str, Any] | None:
        await cls._ensure_table(session)
        result = await session.execute(text(
            "SELECT * FROM ai_proxy_accounts WHERE provider=:p AND name=:n"
        ), {"p": provider, "n": name})
        row = result.fetchone()
        return _row_to_account(row) if row else None

    @classmethod
    async def get_donor(cls, session: Any, provider: str = "v0_app") -> dict[str, Any] | None:
        """Return the first account that still has referral slots available.

        Criteria: ref_url IS NOT NULL AND ref_used_count < ref_max_count,
        ordered by created_at ASC (oldest donor first — exhausts sequentially).
        """
        await cls._ensure_table(session)
        result = await session.execute(text(
            "SELECT * FROM ai_proxy_accounts"
            " WHERE provider = :provider"
            "   AND ref_url IS NOT NULL"
            "   AND ref_used_count < ref_max_count"
            "   AND enabled = 1"
            " ORDER BY created_at ASC"
            " LIMIT 1"
        ), {"provider": provider})
        row = result.fetchone()
        return _row_to_account(row) if row else None

    @classmethod
    async def increment_donor(cls, session: Any, donor_id: int) -> None:
        """Atomically increment ref_used_count for a donor account."""
        await cls._ensure_table(session)
        await session.execute(text(
            "UPDATE ai_proxy_accounts"
            " SET ref_used_count = ref_used_count + 1,"
            "     updated_at = :ts"
            " WHERE id = :id"
        ), {"id": donor_id, "ts": _now_ts()})

    @classmethod
    async def update_ref_fields(
        cls,
        session: Any,
        account_id: int,
        ref_code: str | None,
        ref_url: str | None,
    ) -> None:
        """Set ref_code and ref_url on an existing account (post-registration)."""
        await cls._ensure_table(session)
        await session.execute(text(
            "UPDATE ai_proxy_accounts"
            " SET ref_code = :ref_code, ref_url = :ref_url, updated_at = :ts"
            " WHERE id = :id"
        ), {"id": account_id, "ref_code": ref_code, "ref_url": ref_url, "ts": _now_ts()})
