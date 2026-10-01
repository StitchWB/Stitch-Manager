"""Quota commands — CLI/remote fan-out behind an on-demand TTL cache.

Quota commands fan out to CLI subprocesses and remote usage APIs (~1–2 s),
and the frontend calls them on every page mount — without a cache each
visit repeats the identical fan-out.  This cache returns the last result
within the TTL, coalesces concurrent callers into ONE in-flight fetch and
serves stale data when a refresh fails.  There is NO background polling:
an idle app makes zero calls, so the cache strictly reduces work versus
a per-mount fan-out.  ``{"force": true}`` bypasses the TTL.
"""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)

_QUOTA_CACHE_TTL_SECONDS = 90.0


class _TtlSingleFlight:
    """On-demand TTL cache with single-flight coalescing and stale fallback."""

    def __init__(self, name: str, ttl: float = _QUOTA_CACHE_TTL_SECONDS) -> None:
        self._name = name
        self._ttl = ttl
        self._data: Any = None
        self._expires = 0.0
        self._lock: asyncio.Lock | None = None

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def get_or_fetch(
        self, fetch: Callable[[], Awaitable[Any]], *, force: bool = False
    ) -> Any:
        now = time.monotonic()
        if not force and self._data is not None and self._expires > now:
            return self._data

        async with self._get_lock():
            now = time.monotonic()
            if not force and self._data is not None and self._expires > now:
                return self._data  # another waiter refreshed while we queued

            try:
                data = await fetch()
            except Exception as exc:  # noqa: BLE001
                if self._data is not None:
                    logger.warning(
                        "[%s] refresh failed (%s) — serving stale cache", self._name, exc
                    )
                    return self._data
                raise
            self._data = data
            self._expires = time.monotonic() + self._ttl
            return data


_ALL_QUOTAS_CACHE = _TtlSingleFlight("Quota")
_OPENAI_QUOTAS_CACHE = _TtlSingleFlight("OpenAI Quota")
_KIRO_QUOTAS_CACHE = _TtlSingleFlight("Kiro Quota")


def _auth_dirs() -> list:
    """Return auth directories matching the canonical paths."""
    import os
    import sys
    dirs = []
    override = os.environ.get("STITCH_AI_PROXY_AUTH_DIR", "").strip()
    if override:
        dirs.append(Path(override))
    else:
        if sys.platform == "win32":
            base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        elif sys.platform == "darwin":
            base = Path.home() / "Library" / "Application Support"
        else:
            base = Path.home() / ".local" / "share"
        dirs.append(base / "stitch-manager" / "ai-proxy-sidecar" / "auth")
    legacy = Path.home() / ".cli-proxy-api"
    if legacy.is_dir() and legacy not in dirs:
        dirs.append(legacy)
    return [d for d in dirs if d.is_dir()]


def _quota_from_api_keys_count(openai_count: int, gemini_count: int, antigravity_count: int) -> list[dict]:
    """Build fallback quota entries when CLI tools unavailable (mirrors Rust quota_from_api_keys)."""
    quotas = []
    if gemini_count > 0:
        quotas.append({"provider": "gemini", "totalQuota": -1, "usedQuota": 0, "remainingQuota": -1, "resetAt": None})
    if openai_count > 0:
        quotas.append({"provider": "openai", "totalQuota": -1, "usedQuota": 0, "remainingQuota": -1, "resetAt": None})
    if antigravity_count > 0:
        quotas.append({"provider": "antigravity", "totalQuota": -1, "usedQuota": 0, "remainingQuota": -1, "resetAt": None})
    return quotas


async def _try_cli_quota(cli_name: str, provider: str) -> dict | None:
    """Try running a CLI quota tool (gemini/codex/claude) and parse JSON output."""
    import asyncio
    import json as _json
    try:
        proc = await asyncio.create_subprocess_exec(
            cli_name, "quota", "--json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        if proc.returncode != 0:
            logger.debug("[Quota] %s CLI failed: %s", cli_name, stderr.decode(errors="replace"))
            return None
        data = _json.loads(stdout.decode())
        total = data.get("total", 0)
        used = data.get("used", 0)
        remaining = data.get("remaining", total - used)
        reset_at = data.get("reset_at") or data.get("resetAt")
        return {
            "provider": provider,
            "totalQuota": total,
            "usedQuota": used,
            "remainingQuota": remaining,
            "resetAt": reset_at,
        }
    except (TimeoutError, FileNotFoundError, Exception) as e:
        logger.debug("[Quota] %s CLI unavailable: %s", cli_name, e)
        return None


async def _fetch_all_quotas_impl() -> list:
    """Fetch quota info for all providers via CLI tools, fall back to API key counts."""
    import asyncio

    from stitch_backend.domains.api_keys.service import ApiKeysService

    # Try fetching real quotas from CLI tools concurrently
    cli_results = await asyncio.gather(
        _try_cli_quota("gemini", "gemini"),
        _try_cli_quota("codex", "openai"),
        _try_cli_quota("claude", "claude"),
    )
    quotas = [r for r in cli_results if r is not None]
    providers_found = {q["provider"] for q in quotas}

    # Count API keys from DB for fallback entries
    async def _count_keys(session):
        svc = ApiKeysService(session)
        counts = {}
        for provider in ("gemini", "openai", "antigravity"):
            try:
                keys = await svc.get_keys(provider)
                counts[provider] = len(keys)
            except Exception:
                counts[provider] = 0
        return counts

    try:
        counts = await run_in_session(_count_keys)
    except Exception:
        counts = {}

    fallback = _quota_from_api_keys_count(
        counts.get("openai", 0),
        counts.get("gemini", 0),
        counts.get("antigravity", 0),
    )
    for fb in fallback:
        if fb["provider"] not in providers_found:
            quotas.append(fb)

    return quotas


@register_command("fetch_all_quotas_cmd")
async def cmd_fetch_all_quotas(params: dict) -> list:
    """Cached fan-out (TTL + single-flight). ``{"force": true}`` bypasses TTL."""
    return list(await _ALL_QUOTAS_CACHE.get_or_fetch(
        _fetch_all_quotas_impl, force=bool((params or {}).get("force"))
    ))


async def _fetch_openai_account_quotas_impl() -> list:
    """Fetch OpenAI/Codex account-level quotas from auth files and usage API."""
    import json as _json
    import time

    import httpx

    auth_dirs = _auth_dirs()
    auth_files = []
    for d in auth_dirs:
        for p in d.iterdir():
            if p.suffix == ".json" and (p.stem.startswith("openai-") or p.stem.startswith("codex-")):
                auth_files.append(p)

    if not auth_files:
        return []

    now_ts = int(time.time())
    results = []

    from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
    proxy_url = _get_outbound_proxy()
    async with httpx.AsyncClient(timeout=12.0, proxy=proxy_url) as client:
        for fpath in auth_files:
            account_name = fpath.stem
            try:
                raw = _json.loads(fpath.read_text(encoding="utf-8"))
            except Exception:
                results.append({"accountId": None, "accountName": account_name, "accountEmail": None,
                                "planType": None, "primary": {}, "secondary": None, "fetchedAt": now_ts,
                                "error": "Invalid auth file JSON"})
                continue

            access_token = raw.get("access_token") or raw.get("accessToken") or raw.get("token")
            account_id = raw.get("account_id") or raw.get("accountId")
            email = raw.get("email") or raw.get("account_email") or raw.get("accountEmail")

            if not access_token:
                results.append({"accountId": None, "accountName": account_name, "accountEmail": email,
                                "planType": None, "primary": {}, "secondary": None, "fetchedAt": now_ts,
                                "error": "Missing access_token in auth file"})
                continue

            headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
            if account_id:
                headers["ChatGPT-Account-Id"] = str(account_id)

            try:
                resp = await client.get("https://chatgpt.com/backend-api/wham/usage", headers=headers)
                if resp.status_code != 200:
                    results.append({"accountId": None, "accountName": account_name, "accountEmail": email,
                                    "planType": None, "primary": {}, "secondary": None, "fetchedAt": now_ts,
                                    "error": f"OpenAI API returned {resp.status_code}"})
                    continue
                data = resp.json()
                rate_limit = data.get("rate_limit", {})
                primary = rate_limit.get("primary_window", {})
                secondary = rate_limit.get("secondary_window")
                results.append({
                    "accountId": None, "accountName": account_name, "accountEmail": email,
                    "planType": data.get("plan_type"),
                    "primary": {"usedPercent": primary.get("used_percent", 0), "resetAt": primary.get("reset_at"),
                                "resetAfterSeconds": primary.get("reset_after_seconds"),
                                "totalCount": primary.get("total_count"),
                                "remainingCount": primary.get("remaining_count"),
                                "windowSeconds": primary.get("limit_window_seconds")},
                    "secondary": {"usedPercent": secondary.get("used_percent", 0), "resetAt": secondary.get("reset_at"),
                                  "resetAfterSeconds": secondary.get("reset_after_seconds"),
                                  "totalCount": secondary.get("total_count"),
                                  "remainingCount": secondary.get("remaining_count"),
                                  "windowSeconds": secondary.get("limit_window_seconds")} if secondary else None,
                    "fetchedAt": now_ts, "error": None,
                })
            except Exception as e:
                results.append({"accountId": None, "accountName": account_name, "accountEmail": email,
                                "planType": None, "primary": {}, "secondary": None, "fetchedAt": now_ts,
                                "error": str(e)})

    return results


@register_command("fetch_openai_account_quotas_cmd")
async def cmd_fetch_openai_account_quotas(params: dict) -> list:
    """Cached fan-out (TTL + single-flight). ``{"force": true}`` bypasses TTL."""
    return list(await _OPENAI_QUOTAS_CACHE.get_or_fetch(
        _fetch_openai_account_quotas_impl, force=bool((params or {}).get("force"))
    ))


async def _fetch_kiro_account_quotas_impl() -> list:
    """Fetch Kiro account quotas via CodeWhisperer API using stored tokens."""
    import os
    import sys
    import time

    async def _get_kiro_accounts(session):
        from stitch_backend.domains.ai_proxy.legacy_accounts_api import list_accounts
        all_accounts = await list_accounts(session)
        return [a for a in all_accounts if (a.get("provider") or "").lower() == "kiro"]

    try:
        accounts = await run_in_session(_get_kiro_accounts)
    except Exception as e:
        logger.warning("[Kiro Quota] Failed to fetch accounts: %s", e)
        return []

    if not accounts:
        return []

    now_ts = int(time.time())
    results = []

    # Add autoreg to path for QuotaService import
    autoreg_path = str(Path(__file__).resolve().parents[5] / "python" / "autoreg")
    if autoreg_path not in sys.path:
        sys.path.insert(0, autoreg_path)
    # Also try repo root / python / autoreg
    repo_autoreg = str(Path(os.environ.get("STITCH_REPO_ROOT", "")).resolve() / "python" / "autoreg") if os.environ.get("STITCH_REPO_ROOT") else None
    if repo_autoreg and repo_autoreg not in sys.path:
        sys.path.insert(0, repo_autoreg)

    # Read outbound proxy from kiro-patch config to avoid leaking real IP
    outbound_proxy = None
    try:
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
        outbound_proxy = _get_outbound_proxy()
    except Exception as e:
        logger.debug("[Kiro Quota] Could not read outbound proxy: %s", e)

    for account in accounts:
        account_id = account.get("id", 0)
        account_name = account.get("name", "")
        oauth_token = account.get("oauth_token") or account.get("oauthToken")
        session_token = account.get("session_token") or account.get("sessionToken")

        token = oauth_token or session_token
        if not token:
            results.append({
                "accountId": account_id, "accountName": account_name, "email": None,
                "subscriptionType": None, "used": 0, "limit": 0,
                "percentUsed": 0.0, "daysUntilReset": None, "fetchedAt": now_ts,
                "error": "No OAuth token available",
            })
            continue

        try:
            from autoreg.services.quota_service import QuotaService
            with QuotaService(proxy=outbound_proxy) as svc:
                info = svc.get_quota_from_cw_api(token, "us-east-1", proxy=outbound_proxy)
            if info and info.usage:
                usage = info.usage
                total_limit = usage.limit + (usage.trial_limit if usage.trial_status == "ACTIVE" else 0)
                total_used = usage.used + (usage.trial_used if usage.trial_status == "ACTIVE" else 0)
                pct = (total_used / total_limit * 100) if total_limit > 0 else 0.0
                results.append({
                    "accountId": account_id, "accountName": account_name,
                    "email": info.email, "subscriptionType": info.subscription_type,
                    "used": total_used, "limit": total_limit,
                    "percentUsed": round(pct, 1), "daysUntilReset": info.days_until_reset,
                    "fetchedAt": now_ts, "error": None,
                })
            else:
                results.append({
                    "accountId": account_id, "accountName": account_name, "email": None,
                    "subscriptionType": None, "used": 0, "limit": 0,
                    "percentUsed": 0.0, "daysUntilReset": None, "fetchedAt": now_ts,
                    "error": getattr(info, "error", None) or "NO_QUOTA",
                })
        except Exception as e:
            results.append({
                "accountId": account_id, "accountName": account_name, "email": None,
                "subscriptionType": None, "used": 0, "limit": 0,
                "percentUsed": 0.0, "daysUntilReset": None, "fetchedAt": now_ts,
                "error": str(e),
            })

    return results


@register_command("fetch_kiro_account_quotas_cmd")
async def cmd_fetch_kiro_account_quotas(params: dict) -> list:
    """Cached fan-out (TTL + single-flight). ``{"force": true}`` bypasses TTL."""
    return list(await _KIRO_QUOTAS_CACHE.get_or_fetch(
        _fetch_kiro_account_quotas_impl, force=bool((params or {}).get("force"))
    ))
