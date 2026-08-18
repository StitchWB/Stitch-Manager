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
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import delete, or_, select

from stitch_backend.core.exceptions import AccountNotFoundError
from stitch_backend.domains.accounts.models import Account
from stitch_backend.domains.accounts.schemas import (
    AccountResponse,
    AddAccountRequest,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(UTC)


def _to_response(account: Account, caller_uid: int | None = None) -> AccountResponse:
    """Convert an ORM model → Pydantic response DTO.

    Delegates to the ``@model_validator`` on AccountResponse which handles
    datetime→ISO-string, JSON→string, and field-name mismatches.

    When ``caller_uid`` is given, additive ``mine`` and ``shared`` fields
    are set on the response: ``mine`` = account.owner_id == caller_uid,
    ``shared`` = account.owner_id is None.
    """
    resp = AccountResponse.model_validate(account)
    if caller_uid is not None:
        resp.mine = (account.owner_id == caller_uid)
        resp.shared = (account.owner_id is None)
    return resp


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
        owner_id: int | None = None,
        caller_uid: int | None = None,
    ) -> list[AccountResponse]:
        """Unified listing: supports provider filter and archive visibility.

        When *owner_id* is supplied, only legacy shared rows (owner_id IS
        NULL) and rows owned by *owner_id* are returned (per-user
        isolation).  When *owner_id* is None (desktop / unauthenticated),
        only shared rows are returned.

        When *caller_uid* is given, additive ``mine`` and ``shared``
        fields are set on each response.
        """
        stmt = select(Account).order_by(Account.created_at.desc())
        effective_provider = provider or provider_type or provider_subtype
        if effective_provider:
            stmt = stmt.where(Account.provider == effective_provider)
        if not show_archived:
            stmt = stmt.where(Account.status != "archived")
        # Per-user isolation: shared pool (NULL) OR owned by caller.
        stmt = stmt.where(
            or_(Account.owner_id.is_(None), Account.owner_id == owner_id)
        )
        result = await self._db.execute(stmt)
        return [_to_response(a, caller_uid=caller_uid) for a in result.scalars().all()]

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

    async def add_account(
        self, req: AddAccountRequest, owner_id: int | None = None,
    ) -> AccountResponse:
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
            cookies=req.cookies,
            registration_source="manual",
            owner_id=owner_id,
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

        Schema-adaptive: introspects the ``accounts`` table via
        ``PRAGMA table_info`` to detect whether it uses the legacy Rust-era
        schema (``id INTEGER PRIMARY KEY AUTOINCREMENT``, ``quota_used``
        column present) or the newer Python ORM schema (``id`` String/UUID,
        no ``quota_used``), then builds the INSERT to match.  On the legacy
        schema the ``id`` column is omitted so SQLite auto-assigns the next
        integer rowid; the actual assigned id is read back via
        ``last_insert_rowid()``.
        """
        from sqlalchemy import text as _text

        now_str = _utcnow().isoformat()
        new_uuid = str(uuid.uuid4())

        # ── Introspect the accounts table schema ───────────────────────
        pragma_result = await self._db.execute(
            _text("PRAGMA table_info(accounts)")
        )
        col_rows = pragma_result.fetchall()
        col_types = {row[1]: (row[2] or "") for row in col_rows}

        id_type_upper = col_types.get("id", "").upper()
        is_legacy_id = "INT" in id_type_upper
        has_quota_used = "quota_used" in col_types
        has_quota_limit = "quota_limit" in col_types
        has_login_count = "login_count" in col_types
        has_error_count = "error_count" in col_types

        # ── Build INSERT column/value pairs ────────────────────────────
        # Constant values are inlined as SQL literals; variable values use
        # named parameters (:name).
        col_value_pairs: list[tuple[str, str]] = []

        if not is_legacy_id:
            # ORM schema: id is String/UUID NOT NULL — supply it.
            col_value_pairs.append(("id", ":id"))

        col_value_pairs.extend([
            ("provider", ":provider"),
            ("email", ":email"),
            ("password", ":password"),
            ("token", ":token"),
            ("refresh_token", ":refresh_token"),
            ("status", "'active'"),
            ("display_name", ":display_name"),
            ("api_key", ":api_key"),
            ("registration_source", "'auto'"),
            ("ref_code", ":ref_code"),
            ("ref_url", ":ref_url"),
            ("ref_used_count", "0"),
            ("ref_max_count", ":ref_max_count"),
            ("referred_by_id", ":referred_by_id"),
            ("notes", ":notes"),
            ("tags", "'[]'"),
            ("use_count", "0"),
            ("success_rate", "1.0"),
            ("created_at", ":created_at"),
        ])

        if has_quota_used:
            col_value_pairs.append(("quota_used", "0"))

        if has_quota_limit:
            col_value_pairs.append(("quota_limit", "0"))

        if has_login_count:
            col_value_pairs.append(("login_count", "0"))

        if has_error_count:
            col_value_pairs.append(("error_count", "0"))

        col_names = ", ".join(pair[0] for pair in col_value_pairs)
        col_values = ", ".join(pair[1] for pair in col_value_pairs)

        params: dict[str, str | int | None] = {
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
        if not is_legacy_id:
            params["id"] = new_uuid

        insert_sql = (
            f"INSERT INTO accounts ({col_names}) VALUES ({col_values})"
        )
        await self._db.execute(_text(insert_sql), params)

        # ── Determine the actual assigned id ──────────────────────────
        if is_legacy_id:
            # SQLite auto-assigned the next INTEGER rowid — read it back.
            row_result = await self._db.execute(
                _text("SELECT last_insert_rowid()")
            )
            actual_id = row_result.scalar()
        else:
            actual_id = new_uuid

        await self._db.flush()

        logger.info(
            "Registered account saved: %s (%s) id=%s referred_by=%s",
            email, provider, actual_id, referred_by_id,
        )

        # Return a lightweight namespace — callers only need .id
        # (Do NOT use Account.__new__ — it bypasses SQLAlchemy instrumentation
        # and causes '_sa_instance_state' AttributeError on any attr access.)
        from types import SimpleNamespace
        account = SimpleNamespace(
            id=actual_id,
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

        try:
            health = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: verify_alive(account.token, proxy=proxy),  # type: ignore[arg-type]
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
            refresh_result = await self.refresh_kiro_token(account_id, proxy=proxy, force=True)
            if refresh_result.get("success") and refresh_result.get("refreshed"):
                # Re-read the updated account and retry health check
                account = await self.get_account(account_id)
                try:
                    health = await asyncio.get_event_loop().run_in_executor(
                        None,
                        lambda: verify_alive(account.token, proxy=proxy),  # type: ignore[arg-type]
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

    # ── Bulk export ───────────────────────────────────────────────────────────

    async def bulk_export(
        self,
        provider: str | None = None,
        ids: list[str | int] | None = None,
        owner_id: int | None = None,
    ) -> list[AccountResponse]:
        if ids:
            stmt = select(Account).where(
                Account.id.in_([str(i) for i in ids])
            )
        else:
            stmt = select(Account)
            if provider:
                stmt = stmt.where(Account.provider == provider)
        # Per-user isolation: shared pool (NULL) OR owned by caller.
        stmt = stmt.where(
            or_(Account.owner_id.is_(None), Account.owner_id == owner_id)
        )
        result = await self._db.execute(stmt)
        return [_to_response(a) for a in result.scalars().all()]

    # ── Refresh account (status + quota check) ────────────────────────────────

    async def refresh_account(self, account_id: str) -> AccountResponse:
        """Run a provider status/quota check and return the updated account.

        Delegates to ``account_status.service.check_account_status`` for
        provider-dispatched quota fetching.  On network failure, falls back
        to a timestamp-only update with ``success=True`` and stale quota.
        """
        from stitch_backend.domains.account_status import service as status_service

        account = await self.get_account(account_id)

        # check_account_status expects an int account_id; coerce from str
        try:
            numeric_id = int(account_id)
        except (ValueError, TypeError):
            # UUID-style id — the account_status service uses raw SQL with
            # the id column, which works for both int and str ids.
            numeric_id = account_id  # type: ignore[assignment]

        try:
            await status_service.check_account_status(self._db, numeric_id)
        except Exception as exc:
            # Network failure — fall back to timestamp-only, success=True
            logger.warning(
                "refresh_account: status check failed for %s: %s — "
                "falling back to timestamp-only update",
                account_id, exc,
            )
            account.last_checked_at = _utcnow()
            account.error_count = (account.error_count or 0) + 1
            account.last_error = str(exc)
            account.updated_at = _utcnow()
            await self._db.flush()
            await self._db.refresh(account)
        else:
            # Re-read the account to pick up changes made by status_service
            await self._db.refresh(account)

        return _to_response(account)
