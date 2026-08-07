"""Bridge from the Kiro account pool to the accounts domain.

Loads Kiro accounts as :class:`AccountSnapshot` objects, delegates token
refresh to the existing ``AccountsService.refresh_kiro_token``, and persists
circuit-breaker / suspension state back to the database.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from stitch_backend.domains.accounts.models import Account
from stitch_backend.domains.accounts.service import AccountService
from stitch_backend.domains.kiro_gateway.pool import AccountPool, AccountSnapshot

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _to_unix_ms(dt: datetime | None) -> float:
    """Convert a timezone-aware datetime to unix milliseconds."""
    if dt is None:
        return 0.0
    return dt.timestamp() * 1000


class KiroGatewayService:
    """Load Kiro accounts into the pool, persist state back.

    The pool is an in-memory object — snapshots are rebuilt on each sync.
    Token refresh is delegated to the existing :meth:`AccountService.refresh_kiro_token`.
    """

    def __init__(self, db: AsyncSession, pool: AccountPool) -> None:
        self._db = db
        self._pool = pool
        self._accounts_service = AccountService(db)

    # ── Load snapshots ────────────────────────────────────────────────────

    async def load_accounts(self) -> int:
        """Load all active Kiro accounts into the pool as snapshots.

        Returns the number of accounts loaded.
        """
        from sqlalchemy import select

        stmt = (
            select(Account)
            .where(Account.provider.in_(["kiro", "kiro_v2"]))
            .where(Account.status.in_(["active", "banned", "expired"]))
        )
        result = await self._db.execute(stmt)
        accounts = result.scalars().all()

        count = 0
        for acc in accounts:
            snapshot = self._account_to_snapshot(acc)
            self._pool.add_account(snapshot)
            count += 1

        logger.info("Loaded %d Kiro accounts into pool", count)
        return count

    def _account_to_snapshot(self, acc: Account) -> AccountSnapshot:
        """Convert a DB row to an immutable pool snapshot."""
        meta = acc.provider_metadata or {}
        return AccountSnapshot(
            id=acc.id,
            email=acc.email,
            access_token=acc.token or "",
            refresh_token=acc.refresh_token,
            profile_arn=meta.get("profile_arn") if isinstance(meta, dict) else None,
            machine_id=acc.machine_id,
            expires_at=_to_unix_ms(acc.expires_at),
            _error_count=acc.consecutive_errors or 0,
            _last_used=_to_unix_ms(acc.last_used_at),
            _cooldown_until=_to_unix_ms(acc.cooldown_until),
            _suspended_at=_to_unix_ms(acc.suspended_at),
            _suspend_reason=acc.suspend_reason,
        )

    # ── Token refresh (delegate) ──────────────────────────────────────────

    async def refresh_token(self, account_id: str, *, force: bool = False) -> dict:
        """Refresh the Kiro token via the accounts domain service.

        Returns the same dict as ``AccountService.refresh_kiro_token``.
        """
        # ponytail: read proxy per-call so config changes apply without restart
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
        return await self._accounts_service.refresh_kiro_token(
            account_id, force=force, proxy=_get_outbound_proxy(),
        )

    async def get_snapshot(self, account_id: str) -> AccountSnapshot | None:
        """Re-read an account row and return a fresh pool snapshot.

        Used after a successful token refresh, since ``refresh_kiro_token``
        persists the new tokens to the DB but does not return the raw token.
        """
        acc = await self._accounts_service.get_account(account_id)
        if acc is None:
            return None
        return self._account_to_snapshot(acc)

    async def shutdown(self, *, commit: bool = False) -> None:
        """Commit (optionally) and close the underlying session.

        The service's persist methods use ``flush``; ownership of the session
        lifecycle lives here so callers can't forget the commit.
        """
        try:
            if commit:
                await self._db.commit()
        finally:
            await self._db.close()

    # ── Persist state ─────────────────────────────────────────────────────

    async def persist_circuit_breaker(self, account_id: str) -> None:
        """Write the pool's circuit-breaker state back to the DB."""
        snapshot = self._pool.get_account(account_id)
        if snapshot is None:
            return
        acc = await self._accounts_service.get_account(account_id)
        acc.consecutive_errors = snapshot._error_count
        acc.cooldown_until = (
            datetime.fromtimestamp(snapshot._cooldown_until / 1000, tz=UTC)
            if snapshot._cooldown_until > 0
            else None
        )
        acc.updated_at = _utcnow()
        await self._db.flush()

    async def persist_suspension(self, account_id: str) -> None:
        """Write the pool's suspension state back to the DB."""
        snapshot = self._pool.get_account(account_id)
        if snapshot is None:
            return
        acc = await self._accounts_service.get_account(account_id)
        acc.suspended_at = (
            datetime.fromtimestamp(snapshot._suspended_at / 1000, tz=UTC)
            if snapshot._suspended_at > 0
            else None
        )
        acc.suspend_reason = snapshot._suspend_reason
        acc.consecutive_errors = snapshot._error_count
        if snapshot._suspended_at > 0:
            acc.status = "banned"
        acc.updated_at = _utcnow()
        await self._db.flush()

    async def clear_suspension(self, account_id: str) -> None:
        """Clear suspension in the pool AND in the DB."""
        self._pool.clear_suspended(account_id)
        acc = await self._accounts_service.get_account(account_id)
        acc.suspended_at = None
        acc.suspend_reason = None
        acc.consecutive_errors = 0
        acc.status = "active"
        acc.updated_at = _utcnow()
        await self._db.flush()
