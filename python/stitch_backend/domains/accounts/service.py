"""Accounts service — async CRUD operations backed by SQLAlchemy.

This module is the single point of contact for account data access.
Command handlers in ``commands.py`` delegate here; domains never import
each other's repos directly.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.core.exceptions import AccountNotFoundError
from stitch_backend.domains.accounts.models import Account
from stitch_backend.domains.accounts.schemas import (
    AccountResponse,
    AddAccountRequest,
)

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_response(account: Account) -> AccountResponse:
    """Convert an ORM model → Pydantic response DTO.

    Delegates to the ``@model_validator`` on AccountResponse which handles
    datetime→ISO-string, JSON→string, and field-name mismatches.
    """
    return AccountResponse.model_validate(account)


# ── Service ───────────────────────────────────────────────────────────────────

class AccountService:
    """Async CRUD for accounts."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Read ──────────────────────────────────────────────────────────────────

    async def list_accounts(
        self,
        provider: str | None = None,
        provider_type: str | None = None,
        provider_subtype: str | None = None,
        show_archived: bool = False,
    ) -> list[AccountResponse]:
        """Unified listing: supports provider filter and archive visibility."""
        stmt = select(Account).order_by(Account.created_at.desc())
        effective_provider = provider or provider_type or provider_subtype
        if effective_provider:
            stmt = stmt.where(Account.provider == effective_provider)
        if not show_archived:
            stmt = stmt.where(Account.status != "archived")
        result = await self._db.execute(stmt)
        return [_to_response(a) for a in result.scalars().all()]

    async def get_account(self, account_id: str) -> Account:
        stmt = select(Account).where(Account.id == str(account_id))
        result = await self._db.execute(stmt)
        account = result.scalar_one_or_none()
        if account is None:
            raise AccountNotFoundError(account_id)
        return account

    async def get_account_response(self, account_id: str) -> AccountResponse:
        return _to_response(await self.get_account(account_id))

    # ── Create ────────────────────────────────────────────────────────────────

    async def add_account(self, req: AddAccountRequest) -> AccountResponse:
        account = Account(
            id=str(uuid.uuid4()),
            email=req.email,
            password=req.password,
            provider=req.provider,
            status="active",
            display_name=req.display_name,
            token=req.token,
            refresh_token=req.refresh_token,
            api_key=req.api_key,
            registration_source="manual",
            created_at=_utcnow(),
        )
        self._db.add(account)
        await self._db.flush()
        await self._db.refresh(account)
        logger.info("Account created: %s (%s)", account.email, account.provider)
        return _to_response(account)

    async def add_registered_account(
        self,
        *,
        provider: str,
        email: str,
        password: str | None = None,
        token: str | None = None,
        refresh_token: str | None = None,
        api_key: str | None = None,
        display_name: str | None = None,
        account_type: str | None = None,
        ref_code: str | None = None,
        ref_url: str | None = None,
        ref_max_count: int = 40,
        referred_by_id: str | None = None,
    ) -> Account:
        """Persist an auto-registered account (registration_source='auto').

        Uses a raw INSERT that is compatible with both the legacy Rust-era schema
        (id INTEGER autoincrement, password NOT NULL, etc.) and the newer Python
        ORM schema.  The ORM object is re-loaded after INSERT so callers can
        access account.id regardless of schema.
        """
        from sqlalchemy import text as _text

        now_str = _utcnow().isoformat()
        new_id = str(uuid.uuid4())

        common_params = {
            "id": new_id,
            "provider": provider,
            "email": email,
            "password": password or "",
            "token": token,
            "refresh_token": refresh_token,
            "display_name": display_name or email,
            "api_key": api_key,
            "ref_code": ref_code,
            "ref_url": ref_url,
            "ref_max_count": ref_max_count,
            "referred_by_id": referred_by_id,
            "notes": (f"plan={account_type}" if account_type else None),
            "created_at": now_str,
        }

        # Build INSERT targeting only columns that exist in both schemas.
        # Always include `id` — the current ORM schema uses UUID String (NOT NULL).
        # Try with quota_used first (exists in legacy Rust schema), fall back without.
        try:
            await self._db.execute(
                _text("""
                    INSERT INTO accounts
                        (id, provider, email, password, token, refresh_token, status,
                         display_name, api_key, registration_source,
                         ref_code, ref_url, ref_used_count, ref_max_count, referred_by_id,
                         notes, tags, use_count, success_rate,
                         created_at, quota_used)
                    VALUES
                        (:id, :provider, :email, :password, :token, :refresh_token, 'active',
                         :display_name, :api_key, 'auto',
                         :ref_code, :ref_url, 0, :ref_max_count, :referred_by_id,
                         :notes, '[]', 0, 1.0,
                         :created_at, 0)
                """),
                common_params,
            )
        except Exception:
            # Fallback without quota_used (newer ORM-only schema)
            await self._db.execute(
                _text("""
                    INSERT INTO accounts
                        (id, provider, email, password, token, refresh_token, status,
                         display_name, api_key, registration_source,
                         ref_code, ref_url, ref_used_count, ref_max_count, referred_by_id,
                         notes, tags, use_count, success_rate,
                         created_at)
                    VALUES
                        (:id, :provider, :email, :password, :token, :refresh_token, 'active',
                         :display_name, :api_key, 'auto',
                         :ref_code, :ref_url, 0, :ref_max_count, :referred_by_id,
                         :notes, '[]', 0, 1.0,
                         :created_at)
                """),
                common_params,
            )
        await self._db.flush()

        logger.info(
            "Registered account saved: %s (%s) id=%s referred_by=%s",
            email, provider, new_id, referred_by_id,
        )

        # Return a lightweight namespace — callers only need .id
        # (Do NOT use Account.__new__ — it bypasses SQLAlchemy instrumentation
        # and causes '_sa_instance_state' AttributeError on any attr access.)
        from types import SimpleNamespace
        account = SimpleNamespace(
            id=new_id,
            email=email,
            provider=provider,
            status="active",
            display_name=display_name or email,
            token=token,
            refresh_token=refresh_token,
            api_key=api_key,
            registration_source="auto",
            ref_code=ref_code,
            ref_url=ref_url,
            ref_used_count=0,
            ref_max_count=ref_max_count,
            referred_by_id=referred_by_id,
        )
        return account  # type: ignore[return-value]

    # ── Update ────────────────────────────────────────────────────────────────

    async def update_token(
        self,
        account_id: str,
        token: str,
        refresh_token: str | None = None,
    ) -> AccountResponse:
        account = await self.get_account(account_id)
        account.token = token
        if refresh_token is not None:
            account.refresh_token = refresh_token
        account.updated_at = _utcnow()
        await self._db.flush()
        await self._db.refresh(account)
        return _to_response(account)

    async def update_notes_tags(
        self, account_id: str, notes: str | None = None, tags: str | None = None,
    ) -> AccountResponse:
        account = await self.get_account(account_id)
        if notes is not None:
            account.notes = notes
        if tags is not None:
            try:
                account.tags = json.loads(tags)
            except (json.JSONDecodeError, TypeError):
                account.tags = [tags]
        account.updated_at = _utcnow()
        await self._db.flush()
        await self._db.refresh(account)
        return _to_response(account)

    async def update_metadata(self, account_id: str, metadata: str | None) -> AccountResponse:
        account = await self.get_account(account_id)
        # Store metadata in notes for now (schema compat)
        account.notes = metadata
        account.updated_at = _utcnow()
        await self._db.flush()
        await self._db.refresh(account)
        return _to_response(account)

    async def set_proxy(self, account_id: str, proxy_id: str | None) -> AccountResponse:
        account = await self.get_account(account_id)
        account.proxy_id = proxy_id
        account.updated_at = _utcnow()
        await self._db.flush()
        await self._db.refresh(account)
        return _to_response(account)

    async def archive(self, account_id: str, archived: bool = True) -> AccountResponse:
        account = await self.get_account(account_id)
        account.status = "archived" if archived else "active"
        account.updated_at = _utcnow()
        await self._db.flush()
        await self._db.refresh(account)
        return _to_response(account)

    # ── Delete ────────────────────────────────────────────────────────────────

    async def delete_account(self, account_id: str) -> None:
        account = await self.get_account(account_id)
        await self._db.delete(account)
        await self._db.flush()
        logger.info("Account deleted: %s", account.email)

    async def bulk_delete(self, ids: list[str | int]) -> int:
        str_ids = [str(i) for i in ids]
        stmt = delete(Account).where(Account.id.in_(str_ids))
        result = await self._db.execute(stmt)
        await self._db.flush()
        count = int(result.rowcount)  # type: ignore[attr-defined]
        logger.info("Bulk deleted %d account(s)", count)
        return count

    # ── Provider metadata ─────────────────────────────────────────────────────

    async def update_provider_metadata(
        self,
        account_id: str,
        metadata: dict,
        *,
        merge: bool = True,
    ) -> AccountResponse:
        """Store (or merge) provider-specific metadata on an account.

        Args:
            account_id: Account to update.
            metadata: Dict of key→value pairs to store.
            merge: If True, *update* existing dict keys rather than replacing
                   the whole field (default).  Pass ``False`` to overwrite.
        """
        account = await self.get_account(account_id)
        if merge and isinstance(account.provider_metadata, dict):
            updated = {**account.provider_metadata, **metadata}
        else:
            updated = metadata
        account.provider_metadata = updated
        account.updated_at = _utcnow()
        await self._db.flush()
        await self._db.refresh(account)
        logger.debug("provider_metadata updated for account %s: keys=%s", account_id, list(metadata))
        return _to_response(account)

    # ── Kiro token refresh ────────────────────────────────────────────────────

    async def refresh_kiro_token(
        self,
        account_id: str,
        *,
        proxy: str | None = None,
        force: bool = False,
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
        from autoreg.providers.kiro_v2.token_refresh import (
            TokenRefreshError,
            refresh_from_account_metadata,
            should_refresh_token,
        )

        account = await self.get_account(account_id)

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
                    account.refresh_token,  # type: ignore[arg-type]
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
        self,
        account_id: str,
        *,
        proxy: str | None = None,
        auto_refresh: bool = True,
    ) -> dict:
        """Verify the Kiro account is alive and fetch credit usage.

        Calls GET /getUsageLimits with the stored access token.  If the call
        returns 401 and ``auto_refresh=True``, attempts a token refresh first.

        Returns:
            Dict with ``alive``, ``suspended``, ``email``, ``subscription``,
            ``credit_used``, ``credit_limit``, ``credit_remaining`` and the
            updated ``account`` snapshot.
        """
        from autoreg.providers.kiro_v2.verify_alive import verify_alive

        account = await self.get_account(account_id)

        if not account.token:
            return {"alive": False, "error": "no access_token stored"}

        health = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: verify_alive(account.token, proxy=proxy),  # type: ignore[arg-type]
        )

        # Token expired — try refresh once
        if not health.alive and "401" in health.error and auto_refresh and account.refresh_token:
            logger.info("check_kiro_account: token expired, attempting refresh for %s", account_id)
            refresh_result = await self.refresh_kiro_token(account_id, proxy=proxy, force=True)
            if refresh_result.get("success") and refresh_result.get("refreshed"):
                # Re-read the updated account and retry health check
                account = await self.get_account(account_id)
                health = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: verify_alive(account.token, proxy=proxy),  # type: ignore[arg-type]
                )

        # Update last_checked_at and status
        account.last_checked_at = _utcnow()
        if health.suspended:
            account.status = "banned"
        elif not health.alive and "expired" in health.error:
            account.status = "expired"
        elif health.alive:
            account.status = "active"
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

    # ── Bulk export ───────────────────────────────────────────────────────────

    async def bulk_export(
        self, provider: str | None = None, ids: list[str | int] | None = None,
    ) -> list[AccountResponse]:
        if ids:
            stmt = select(Account).where(Account.id.in_([str(i) for i in ids]))
        else:
            stmt = select(Account)
            if provider:
                stmt = stmt.where(Account.provider == provider)
        result = await self._db.execute(stmt)
        return [_to_response(a) for a in result.scalars().all()]
