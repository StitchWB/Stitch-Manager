"""Accounts service — async CRUD operations backed by SQLAlchemy.

This module is the single point of contact for account data access.
Command handlers in ``commands.py`` delegate here; domains never import
each other's repos directly.
"""

from __future__ import annotations

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
            is_llm_account=req.is_llm_account,
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

        Returns the ORM object (caller may need its id for follow-up work such
        as donor-counter increments within the same session).
        """
        account = Account(
            id=str(uuid.uuid4()),
            email=email,
            password=password,
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
            notes=(f"plan={account_type}" if account_type else None),
            created_at=_utcnow(),
        )
        self._db.add(account)
        await self._db.flush()
        await self._db.refresh(account)
        logger.info(
            "Registered account saved: %s (%s) id=%s referred_by=%s",
            account.email, account.provider, account.id, referred_by_id,
        )
        return account

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
