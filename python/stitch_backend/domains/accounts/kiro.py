"""Kiro token refresh and health-check leaves for AccountService."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from stitch_backend.domains.accounts.helpers import _to_response, _utcnow

if TYPE_CHECKING:
    from stitch_backend.domains.accounts.service import AccountService

# Pin the original module's logger name: log routing keys on it.
logger = logging.getLogger("stitch_backend.domains.accounts.service")


async def refresh_kiro_token(
    self: AccountService,
    account_id: str,
    *,
    proxy: str | None = None,
    force: bool = False,
    caller_uid: int | None = None,
) -> dict:
    """Refresh the Kiro access token for *account_id*.

    Uses ``provider_metadata.client_id`` + ``client_secret`` when stored
    (v2/v3 registration flow), otherwise falls back to the legacy
    clientIdHash approach.

    Args:
        account_id: Account whose token should be refreshed.
        proxy: Optional proxy URL to use for the OIDC request.
        force: Refresh even if the token has not expired yet.

    Returns:
        Dict with ``{"success": True, "expires_at": "…", "account": AccountResponse}``.

    Raises:
        ``stitch_backend.core.exceptions.AccountNotFoundError`` if the account
        doesn't exist, or a ``TokenRefreshError`` on OIDC failure.
    """
    try:
        from autoreg.providers.kiro_v2.token_refresh import (
            TokenRefreshError,
            refresh_from_account_metadata,
            should_refresh_token,
        )
    except ImportError:  # open-core: kiro_v2 method not installed
        return {
            "success": False,
            "error": "kiro_v2 method not installed — install plugin",
        }

    account = await self.get_account(account_id)
    self._check_ownership(account, caller_uid, account_id)

    if not account.refresh_token:
        return {"success": False, "error": "no refresh_token stored for this account"}

    if not force:
        expires_at_str = (
            account.expires_at.isoformat() if account.expires_at else None
        )
        if not should_refresh_token(expires_at_str, buffer_seconds=300):
            return {
                "success": True,
                "refreshed": False,
                "message": "token still valid",
                "expires_at": expires_at_str,
                "account": _to_response(account),
            }

    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: refresh_from_account_metadata(
                account.refresh_token,  # type: ignore[arg-type,unused-ignore]
                account.provider_metadata,
                proxy=proxy,
            ),
        )
    except TokenRefreshError as exc:
        logger.warning("Token refresh failed for account %s: %s", account_id, exc)
        account.status = "expired"
        account.updated_at = _utcnow()
        await self._db.flush()
        return {"success": False, "error": str(exc)}

    # Persist the new tokens
    account.token = result["access_token"]
    if result.get("refresh_token"):
        account.refresh_token = result["refresh_token"]

    expires_at_str = result.get("expires_at")
    if expires_at_str:
        try:
            from datetime import datetime
            account.expires_at = datetime.fromisoformat(
                expires_at_str.replace("Z", "+00:00")
            )
        except ValueError:
            pass

    account.status = "active"
    account.updated_at = _utcnow()
    await self._db.flush()
    await self._db.refresh(account)

    logger.info("Token refreshed for account %s (%s)", account_id, account.email)
    return {
        "success": True,
        "refreshed": True,
        "expires_at": expires_at_str,
        "account": _to_response(account),
    }


async def check_kiro_account(
    self: AccountService,
    account_id: str,
    *,
    proxy: str | None = None,
    auto_refresh: bool = True,
    caller_uid: int | None = None,
) -> dict:
    """Verify the Kiro account is alive and fetch credit usage.

    Calls GET /getUsageLimits with the stored access token.  If the call
    returns 401 and ``auto_refresh=True``, attempts a token refresh first.

    Returns:
        Dict with ``alive``, ``suspended``, ``email``, ``subscription``,
        ``credit_used``, ``credit_limit``, ``credit_remaining`` and the
        updated ``account`` snapshot.
    """
    try:
        from autoreg.providers.kiro_v2.verify_alive import verify_alive
    except ImportError:  # open-core: kiro_v2 method not installed
        return {
            "alive": False,
            "error": "kiro_v2 method not installed — install plugin",
        }

    account = await self.get_account(account_id)
    self._check_ownership(account, caller_uid, account_id)

    if not account.token:
        return {"alive": False, "error": "no access_token stored"}

    try:
        health = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: verify_alive(account.token, proxy=proxy),  # type: ignore[arg-type,unused-ignore]
        )
    except Exception as exc:
        # Network/parse failure — record error, fall back to stale quota
        account.error_count = (account.error_count or 0) + 1
        account.last_error = str(exc)
        account.last_checked_at = _utcnow()
        account.updated_at = _utcnow()
        await self._db.flush()
        await self._db.refresh(account)
        return {
            "alive": False,
            "error": str(exc),
            "account": _to_response(account),
        }

    # Token expired — try refresh once
    if not health.alive and "401" in health.error and auto_refresh and account.refresh_token:
        logger.info("check_kiro_account: token expired, attempting refresh for %s", account_id)
        refresh_result = await self.refresh_kiro_token(
            account_id, proxy=proxy, force=True, caller_uid=caller_uid,
        )
        if refresh_result.get("success") and refresh_result.get("refreshed"):
            # Re-read the updated account and retry health check
            account = await self.get_account(account_id)
            try:
                health = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: verify_alive(account.token, proxy=proxy),  # type: ignore[arg-type,unused-ignore]
                )
            except Exception as exc:
                account.error_count = (account.error_count or 0) + 1
                account.last_error = str(exc)
                account.last_checked_at = _utcnow()
                account.updated_at = _utcnow()
                await self._db.flush()
                await self._db.refresh(account)
                return {
                    "alive": False,
                    "error": str(exc),
                    "account": _to_response(account),
                }

    # Update last_checked_at, status, quota, and error tracking
    account.last_checked_at = _utcnow()
    if health.suspended:
        account.status = "banned"
        account.error_count = (account.error_count or 0) + 1
        account.last_error = health.error
    elif not health.alive and "expired" in health.error:
        account.status = "expired"
        account.error_count = (account.error_count or 0) + 1
        account.last_error = health.error
    elif health.alive:
        account.status = "active"
        # Persist quota from the health check
        account.quota_used = int(health.credit_used)
        account.quota_limit = int(health.credit_limit)
        account.quota_checked_at = _utcnow()
        # Clear error on success
        account.last_error = None
    account.updated_at = _utcnow()
    await self._db.flush()
    await self._db.refresh(account)

    return {
        "alive": health.alive,
        "suspended": health.suspended,
        "email": health.email,
        "subscription": health.subscription,
        "credit_used": health.credit_used,
        "credit_limit": health.credit_limit,
        "credit_remaining": health.credit_remaining,
        "region": health.region,
        "error": health.error,
        "checked_at": health.checked_at,
        "account": _to_response(account),
    }
