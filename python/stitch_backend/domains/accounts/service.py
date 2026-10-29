"""Accounts service — async CRUD operations backed by SQLAlchemy.

This module is the single point of contact for account data access.
Command handlers in ``commands.py`` delegate here; domains never import
each other's repos directly.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from sqlalchemy import delete, or_, select

from stitch_backend.core.exceptions import AccountNotFoundError
from stitch_backend.domains.accounts import kiro, listing, registered
from stitch_backend.domains.accounts.helpers import _to_response, _utcnow
from stitch_backend.domains.accounts.models import Account

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from stitch_backend.domains.accounts.schemas import (
        AccountResponse,
        AddAccountRequest,
    )

logger = logging.getLogger(__name__)


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
        return await listing.list_accounts(
            self,
            provider,
            provider_type,
            provider_subtype,
            show_archived,
            owner_id,
            caller_uid,
        )

    async def get_account(self, account_id: str) -> Account:
        stmt = select(Account).where(Account.id == str(account_id))
        result = await self._db.execute(stmt)
        account = result.scalar_one_or_none()
        if account is None:
            raise AccountNotFoundError(account_id)
        return account

    @staticmethod
    def _check_ownership(account: Account, caller_uid: int | None, account_id: str) -> None:
        """Reject non-owner callers (IDOR guard).

        When ``caller_uid`` is None (desktop / auth disabled) the check is
        skipped — legacy permissive behaviour.  When set, the caller may
        mutate the account only if it is instance-shared (``owner_id`` is
        NULL) or owned by ``caller_uid``; otherwise a 404 is raised (404,
        not 403, to avoid existence leakage — IDOR best practice).

        ── Divergence from ``ai_gateway._owner_filter`` (intentional) ──

        The accounts domain is *desktop-permissive*: ``caller_uid`` None
        means "no auth, allow everything" (single-trusted-user desktop
        model).  The ai_gateway domain's ``_owner_filter`` takes the
        opposite stance: ``uid`` None matches *shared rows only*
        (``owner_id IS NULL``), hiding user-owned rows from unauthenticated
        callers.  Both postures are intentional legacy-compat decisions:
        accounts pre-dates the per-user isolation rollout and must stay
        permissive when auth is off; ai_gateway was born multi-user and
        treats NULL uid as "anonymous, shared pool only".  Do NOT "align"
        the two without a migration plan — desktop deployments rely on the
        accounts domain's permissive NULL-uid behaviour.
        """
        if caller_uid is not None and account.owner_id is not None and account.owner_id != caller_uid:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Account not found: {account_id}",
            )

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
        return await registered.add_registered_account(
            self,
            provider=provider,
            email=email,
            password=password,
            token=token,
            refresh_token=refresh_token,
            api_key=api_key,
            display_name=display_name,
            account_type=account_type,
            ref_code=ref_code,
            ref_url=ref_url,
            ref_max_count=ref_max_count,
            referred_by_id=referred_by_id,
        )

    # ── Update ────────────────────────────────────────────────────────────────

    async def update_token(
        self,
        account_id: str,
        token: str,
        refresh_token: str | None = None,
        *,
        caller_uid: int | None = None,
    ) -> AccountResponse:
        account = await self.get_account(account_id)
        self._check_ownership(account, caller_uid, account_id)
        account.token = token
        if refresh_token is not None:
            account.refresh_token = refresh_token
        account.updated_at = _utcnow()
        await self._db.flush()
        await self._db.refresh(account)
        return _to_response(account)

    async def update_notes_tags(
        self, account_id: str, notes: str | None = None, tags: str | None = None,
        *,
        caller_uid: int | None = None,
    ) -> AccountResponse:
        account = await self.get_account(account_id)
        self._check_ownership(account, caller_uid, account_id)
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

    async def update_metadata(
        self, account_id: str, metadata: str | None,
        *,
        caller_uid: int | None = None,
    ) -> AccountResponse:
        account = await self.get_account(account_id)
        self._check_ownership(account, caller_uid, account_id)
        # Store metadata in notes for now (schema compat)
        account.notes = metadata
        account.updated_at = _utcnow()
        await self._db.flush()
        await self._db.refresh(account)
        return _to_response(account)

    async def set_proxy(
        self, account_id: str, proxy_id: str | None,
        *,
        caller_uid: int | None = None,
    ) -> AccountResponse:
        account = await self.get_account(account_id)
        self._check_ownership(account, caller_uid, account_id)
        account.proxy_id = proxy_id
        account.updated_at = _utcnow()
        await self._db.flush()
        await self._db.refresh(account)
        return _to_response(account)

    async def archive(
        self, account_id: str, archived: bool = True, *,
        caller_uid: int | None = None,
    ) -> AccountResponse:
        account = await self.get_account(account_id)
        self._check_ownership(account, caller_uid, account_id)
        account.status = "archived" if archived else "active"
        account.updated_at = _utcnow()
        await self._db.flush()
        await self._db.refresh(account)
        return _to_response(account)

    # ── Delete ────────────────────────────────────────────────────────────────

    async def delete_account(
        self, account_id: str, *, caller_uid: int | None = None,
    ) -> None:
        account = await self.get_account(account_id)
        # Group owners may delete accounts shared into their groups, bypassing the standard _check_ownership rules.
        from stitch_backend.domains.groups.service import (
            is_group_owner_of_resource,
        )

        if not await is_group_owner_of_resource(
            self._db,
            resource_type="account",
            resource_id=str(account.id),
            uid=caller_uid,
        ):
            self._check_ownership(account, caller_uid, account_id)
        await self._db.delete(account)
        await self._db.flush()
        logger.info("Account deleted: %s", account.email)

    async def bulk_delete(
        self, ids: list[str | int], *, caller_uid: int | None = None,
    ) -> int:
        str_ids = [str(i) for i in ids]
        stmt = delete(Account).where(Account.id.in_(str_ids))
        if caller_uid is not None:
            # Caller may delete shared (NULL), own, or accounts in groups they own.
            from sqlalchemy import and_
            from sqlalchemy import select as sa_select

            from stitch_backend.domains.groups.models import GroupMember, GroupShare

            group_owner_account_ids_subq = (
                sa_select(GroupShare.resource_id)
                .join(
                    GroupMember,
                    GroupMember.group_id == GroupShare.group_id,
                )
                .where(
                    and_(
                        GroupShare.resource_type == "account",
                        GroupMember.user_id == caller_uid,
                        GroupMember.role == "owner",
                    )
                )
                .scalar_subquery()
            )
            stmt = stmt.where(
                or_(
                    Account.owner_id.is_(None),
                    Account.owner_id == caller_uid,
                    Account.id.in_(group_owner_account_ids_subq),
                )
            )
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
        caller_uid: int | None = None,
    ) -> dict:
        return await kiro.refresh_kiro_token(
            self, account_id, proxy=proxy, force=force, caller_uid=caller_uid
        )

    async def check_kiro_account(
        self,
        account_id: str,
        *,
        proxy: str | None = None,
        auto_refresh: bool = True,
        caller_uid: int | None = None,
    ) -> dict:
        return await kiro.check_kiro_account(
            self, account_id, proxy=proxy, auto_refresh=auto_refresh, caller_uid=caller_uid
        )

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

    async def refresh_account(
        self, account_id: str, *, caller_uid: int | None = None,
    ) -> AccountResponse:
        """Run a provider status/quota check and return the updated account.

        Delegates to ``account_status.service.check_account_status`` for
        provider-dispatched quota fetching.  On network failure, falls back
        to a timestamp-only update with ``success=True`` and stale quota.
        """
        from stitch_backend.domains.account_status import service as status_service

        account = await self.get_account(account_id)
        self._check_ownership(account, caller_uid, account_id)

        # check_account_status expects an int account_id; coerce from str
        try:
            numeric_id = int(account_id)
        except (ValueError, TypeError):
            # UUID-style id: account_status uses raw SQL on the id column, valid for int and str.
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
