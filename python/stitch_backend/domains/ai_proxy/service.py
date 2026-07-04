"""AI Proxy service — DB operations, analytics, auth flows, IDE detection.

Ports Rust ``database/ai_proxy.rs`` and ``services/ai_proxy/*.rs`` to Python.
Uses raw SQL via SQLAlchemy ``text()`` since ``ai_proxy_accounts`` is a flat
table without an ORM model.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import text


logger = logging.getLogger(__name__)


# ── Helpers ────────────────────────────────────────────────────────────────────

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
        # Referral quota fields
        "refCode": getattr(row, "ref_code", None),
        "refUrl": getattr(row, "ref_url", None),
        "refUsedCount": getattr(row, "ref_used_count", 0) or 0,
        "refMaxCount": getattr(row, "ref_max_count", 40) or 40,
        "referredById": getattr(row, "referred_by_id", None),
    }


# ── Account Store ─────────────────────────────────────────────────────────────

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
        # Migrate: add columns that might be missing from older table versions
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
            # Referral fields (v0_app quota system)
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


# ── Analytics ─────────────────────────────────────────────────────────────────

class AiProxyAnalytics:
    """Aggregation queries on request logs."""

    @classmethod
    async def get_daily_stats(cls, session: Any) -> dict[str, Any]:
        try:
            result = await session.execute(text(
                "SELECT COUNT(*) as total_requests,"
                " COALESCE(SUM(tokens_used),0) as total_tokens,"
                " COALESCE(SUM(estimated_cost),0.0) as estimated_cost"
                " FROM ai_proxy_request_logs"
                " WHERE created_at >= strftime('%s','now','-1 day')"
            ))
            row = result.fetchone()
            return {
                "totalRequests": row.total_requests if row else 0,
                "totalTokens": row.total_tokens if row else 0,
                "estimatedCost": float(row.estimated_cost) if row else 0.0,
            }
        except Exception:
            return {"totalRequests": 0, "totalTokens": 0, "estimatedCost": 0.0}

    @classmethod
    async def get_model_usage(cls, session: Any) -> list[dict[str, Any]]:
        try:
            result = await session.execute(text(
                "SELECT model, COUNT(*) as requests, COALESCE(SUM(tokens_used),0) as tokens"
                " FROM ai_proxy_request_logs"
                " WHERE created_at >= strftime('%s','now','-7 days')"
                " GROUP BY model ORDER BY requests DESC LIMIT 50"
            ))
            return [
                {"model": r.model, "requests": r.requests, "tokens": r.tokens}
                for r in result.fetchall()
            ]
        except Exception:
            return []

    @classmethod
    async def get_cost_estimate(cls, session: Any) -> float:
        try:
            result = await session.execute(text(
                "SELECT COALESCE(SUM(estimated_cost),0.0) as total"
                " FROM ai_proxy_request_logs"
                " WHERE created_at >= strftime('%s','now','-30 days')"
            ))
            row = result.fetchone()
            return float(row.total) if row else 0.0
        except Exception:
            return 0.0

    @classmethod
    async def get_weekly_stats(cls, session: Any) -> list[dict[str, Any]]:
        try:
            result = await session.execute(text(
                "SELECT date(created_at, 'unixepoch') as day,"
                " COUNT(*) as requests, COALESCE(SUM(tokens_used),0) as tokens"
                " FROM ai_proxy_request_logs"
                " WHERE created_at >= strftime('%s','now','-7 days')"
                " GROUP BY day ORDER BY day"
            ))
            return [
                {"day": r.day, "requests": r.requests, "tokens": r.tokens}
                for r in result.fetchall()
            ]
        except Exception:
            return []

    @classmethod
    async def get_daily_usage_by_account(cls, session: Any) -> list[dict[str, Any]]:
        try:
            result = await session.execute(text(
                "SELECT a.provider, a.name, COUNT(l.id) as requests,"
                " COALESCE(SUM(l.tokens_used),0) as tokens"
                " FROM ai_proxy_accounts a"
                " LEFT JOIN ai_proxy_request_logs l"
                "   ON l.account_id = a.id"
                "   AND l.created_at >= strftime('%s','now','-1 day')"
                " WHERE a.enabled = 1"
                " GROUP BY a.id ORDER BY requests DESC"
            ))
            return [
                {"provider": r.provider, "name": r.name, "requests": r.requests, "tokens": r.tokens}
                for r in result.fetchall()
            ]
        except Exception:
            return []


# ── Auth Flow Session Manager ─────────────────────────────────────────────────

_TTL_SECONDS = 600  # 10 minutes

@dataclass
class AuthFlowSession:
    session_id: str
    provider: str
    state: str
    auth_url: str
    callback_url: str | None = None
    phase: str = "awaiting_user"
    error: str | None = None
    created_at: int = 0
    updated_at: int = 0
    expires_at: int = 0
    flow_type: str | None = None


class AuthFlowSessionManager:
    """In-memory session store for OAuth / device-code flows."""

    def __init__(self) -> None:
        self._sessions: dict[str, AuthFlowSession] = {}

    def _cleanup(self) -> None:
        now = _now_ts()
        expired = [k for k, v in self._sessions.items() if v.expires_at <= now]
        for k in expired:
            del self._sessions[k]

    def create_session(self, provider: str, auth_url: str, state: str = "",
                       flow_type: str | None = None) -> AuthFlowSession:
        self._cleanup()
        now = _now_ts()
        session = AuthFlowSession(
            session_id=f"sess_{uuid.uuid4().hex[:16]}",
            provider=provider,
            state=state,
            auth_url=auth_url,
            flow_type=flow_type,
            created_at=now,
            updated_at=now,
            expires_at=now + _TTL_SECONDS,
        )
        self._sessions[session.session_id] = session
        return session

    def get_session(self, session_id: str) -> AuthFlowSession | None:
        self._cleanup()
        return self._sessions.get(session_id)

    def update_session(self, session_id: str, **kwargs: Any) -> None:
        session = self._sessions.get(session_id)
        if not session:
            return
        for k, v in kwargs.items():
            setattr(session, k, v)
        session.updated_at = _now_ts()

    def remove_session(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None


_auth_flow_mgr: AuthFlowSessionManager | None = None


def get_auth_flow_manager() -> AuthFlowSessionManager:
    global _auth_flow_mgr
    if _auth_flow_mgr is None:
        _auth_flow_mgr = AuthFlowSessionManager()
    return _auth_flow_mgr


# ── IDE Detector ──────────────────────────────────────────────────────────────

@dataclass
class DetectedIde:
    name: str
    display_name: str
    path: str
    version: str = ""
    configured: bool = False


class IdeDetector:
    """Scan known paths for installed IDEs."""

    _KNOWN_IDES: list[tuple[str, str, list[str]]] = [
        ("kiro", "Kiro", [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Kiro"),
            os.path.expandvars(r"%LOCALAPPDATA%\Kiro"),
        ]),
        ("cursor", "Cursor", [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Cursor"),
            os.path.expandvars(r"%LOCALAPPDATA%\Cursor"),
        ]),
        ("windsurf", "Windsurf", [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Windsurf"),
            os.path.expandvars(r"%LOCALAPPDATA%\Windsurf"),
        ]),
        ("trae", "Trae", [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Trae"),
            os.path.expandvars(r"%LOCALAPPDATA%\Trae"),
        ]),
        ("opencode", "OpenCode", [
            os.path.expandvars(r"%USERPROFILE%\.opencode"),
            str(Path.home() / ".opencode"),
        ]),
    ]

    @classmethod
    def detect_all(cls) -> list[DetectedIde]:
        found: list[DetectedIde] = []
        for ide_id, display_name, candidates in cls._KNOWN_IDES:
            for path in candidates:
                if Path(path).exists():
                    found.append(DetectedIde(
                        name=ide_id,
                        display_name=display_name,
                        path=path,
                    ))
                    break
        return found


# ── Auth File Scanner ─────────────────────────────────────────────────────────

@dataclass
class AuthFile:
    provider: str
    path: str
    token: str
    expires_at: int | None = None


class AuthFileScanner:
    """Scan standard locations for auth JSON files."""

    _PROVIDERS = ("openai", "gemini", "anthropic", "antigravity", "kiro", "fireworks")

    @classmethod
    def scan_all(cls) -> list[AuthFile]:
        results: list[AuthFile] = []
        search_dirs = [
            Path.home() / ".stitch-manager" / "auth",
            Path.home() / ".config" / "stitch",
        ]
        for d in search_dirs:
            if not d.is_dir():
                continue
            for f in d.iterdir():
                if not f.is_file() or f.suffix != ".json":
                    continue
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                    provider = data.get("provider", "")
                    token = data.get("token", data.get("apiKey", data.get("api_key", "")))
                    if not provider or not token:
                        continue
                    results.append(AuthFile(
                        provider=provider,
                        path=str(f),
                        token=token,
                        expires_at=data.get("expiresAt") or data.get("expires_at"),
                    ))
                except (json.JSONDecodeError, OSError):
                    continue
        return results


# ── Settings K/V helpers ──────────────────────────────────────────────────────

_SETTINGS_TABLE_READY = False


async def _ensure_settings_table(session: Any) -> None:
    """Create the ``ai_proxy_settings`` K/V table if it doesn't exist."""
    global _SETTINGS_TABLE_READY  # noqa: PLW0603
    if _SETTINGS_TABLE_READY:
        return
    await session.execute(text(
        "CREATE TABLE IF NOT EXISTS ai_proxy_settings ("
        "  key TEXT PRIMARY KEY,"
        "  value TEXT,"
        "  updated_at INTEGER"
        ")"
    ))
    _SETTINGS_TABLE_READY = True


async def get_settings_kv(session: Any, key: str) -> str | None:
    """Read a value from ``ai_proxy_settings`` K/V table."""
    await _ensure_settings_table(session)
    result = await session.execute(
        text("SELECT value FROM ai_proxy_settings WHERE key = :k"),
        {"k": key},
    )
    row = result.fetchone()
    return row.value if row else None


async def set_settings_kv(session: Any, key: str, value: str) -> None:
    """Write a value to ``ai_proxy_settings`` K/V table."""
    await _ensure_settings_table(session)
    await session.execute(text(
        "INSERT OR REPLACE INTO ai_proxy_settings (key, value, updated_at)"
        " VALUES (:k, :v, :ts)"
    ), {"k": key, "v": value, "ts": _now_ts()})


# ── Export / Import ───────────────────────────────────────────────────────────

async def export_accounts_payload(
    session: Any, fmt: str = "json", include_secrets: bool = False
) -> str:
    accounts = await AiProxyAccountStore.get_accounts(session)
    export_rows = []
    for a in accounts:
        row: dict[str, Any] = {
            "provider": a["provider"],
            "name": a["name"],
            "enabled": a["enabled"],
            "accountType": a["accountType"],
            "softQuotaTokensDaily": a["softQuotaTokensDaily"],
            "softQuotaRequestsDaily": a["softQuotaRequestsDaily"],
        }
        if include_secrets:
            row["oauthToken"] = a["oauthToken"]
            row["apiKey"] = a["apiKey"]
            row["sessionToken"] = a["sessionToken"]
        export_rows.append(row)

    payload = {
        "version": 1,
        "exportedAt": _iso_now(),
        "includeSecrets": include_secrets,
        "accounts": export_rows,
    }

    if fmt.lower() == "csv":
        lines = ["provider,name,enabled,account_type"]
        for a in export_rows:
            lines.append(
                f'"{a["provider"]}","{a["name"]}",{1 if a["enabled"] else 0},"{a.get("accountType", "")}"'
            )
        return "\n".join(lines)

    return json.dumps(payload, indent=2)


async def import_accounts_payload(session: Any, payload_str: str) -> int:
    data = json.loads(payload_str)
    accounts = data.get("accounts", [])
    existing = await AiProxyAccountStore.get_accounts(session)
    existing_keys = {
        f"{a['provider'].lower()}::{a['name'].lower()}" for a in existing
    }

    imported = 0
    for row in accounts:
        provider = row.get("provider", "").lower()
        name = row.get("name", "")
        dedupe_key = f"{provider}::{name.lower()}"
        if dedupe_key in existing_keys:
            continue
        account = {
            "provider": provider,
            "name": name,
            "enabled": row.get("enabled", True),
            "accountType": row.get("accountType"),
            "softQuotaTokensDaily": row.get("softQuotaTokensDaily"),
            "softQuotaRequestsDaily": row.get("softQuotaRequestsDaily"),
            "oauthToken": row.get("oauthToken"),
            "apiKey": row.get("apiKey"),
            "sessionToken": row.get("sessionToken"),
        }
        await AiProxyAccountStore.create_account(session, account)
        existing_keys.add(dedupe_key)
        imported += 1
    return imported


# ── Helpers ──────────────────────────────────────────────────────────────────

def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
