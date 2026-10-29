"""Outlook mailbox pool — consumer-side dequeue service.

The producer (provider plugin ``outlook``) registers mailboxes as
account rows: ``provider='outlook'``, ``password`` = mailbox password,
``token``/``api_key`` = refresh token, ``provider_metadata`` = the
token_data JSON (``client_id``, ``scope``, ``redirect_uri``,
``expires_in``).  This service dequeues unconsumed rows for the
``outlook_pool`` email strategy via the autoreg bridge and retires
mailboxes whose refresh tokens were rejected (``invalid_grant``).

Consumption marker: the ``tags`` JSON column gains
``outlook_pool_consumed`` at dequeue time (the accounts ``status``
field stays a health signal).  A dead refresh token sets
``status='expired'`` plus ``last_error``, which removes the row from
the dequeue filter for good.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any, TypeVar

from sqlalchemy import select, update

from stitch_backend.database import get_session_factory
from stitch_backend.domains.accounts.models import Account

if TYPE_CHECKING:
    from collections.abc import Callable, Coroutine

logger = logging.getLogger(__name__)

_T = TypeVar("_T")

PROVIDER_ID = "outlook"
CONSUMED_TAG = "outlook_pool_consumed"
_CANDIDATE_LIMIT = 50
_SYNC_CALL_TIMEOUT = 10.0

_instance: OutlookMailboxPoolService | None = None


def get_outlook_mailbox_pool_service() -> OutlookMailboxPoolService:
    """Return the singleton service, creating it if necessary."""
    global _instance  # noqa: PLW0603
    if _instance is None:
        _instance = OutlookMailboxPoolService()
    return _instance


class OutlookMailboxPoolService:
    """Dequeues outlook mailbox account rows for the autoreg bridge."""

    def claim_next_sync(self) -> dict[str, Any] | None:
        """
        Claim the next unconsumed mailbox synchronously.

        Called from ``autoreg`` provider code, which may run in a thread
        without an active event loop.

        Returns:
            Dict with ``id``, ``email``, ``password``, ``refresh_token``,
            ``token_data`` or ``None`` when the pool is empty.
        """
        return self._call_sync(self._claim_next_async)

    def mark_unusable_sync(self, account_id: str, error: str) -> None:
        """Retire a mailbox whose refresh token was rejected (DB write)."""
        self._call_sync(self.mark_unusable_async, account_id, error)

    def register_bridge(self) -> None:
        """
        Register the fetch and mark-unusable functions with the autoreg bridge.

        Called once during stitch_backend lifespan so that all
        CommonProvider instances using the OUTLOOK_POOL strategy can
        dequeue mailboxes without knowing about stitch_backend internals.
        """
        from autoreg.stitch_backend_bridge import (
            set_outlook_pool_fetch_fn,
            set_outlook_pool_mark_unusable_fn,
        )

        set_outlook_pool_fetch_fn(self.claim_next_sync)
        set_outlook_pool_mark_unusable_fn(self.mark_unusable_sync)
        logger.info("Outlook mailbox pool bridge registered.")

    def _call_sync(self, coro_fn: Callable[..., Coroutine[Any, Any, _T]], *args: Any) -> _T | None:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures

                future: concurrent.futures.Future[_T] = concurrent.futures.Future()

                def _run() -> None:
                    task = asyncio.ensure_future(coro_fn(*args))
                    task.add_done_callback(
                        lambda t: (
                            future.set_result(t.result())
                            if not t.exception()
                            else future.set_exception(t.exception())
                        )
                    )

                loop.call_soon_threadsafe(_run)
                return future.result(timeout=_SYNC_CALL_TIMEOUT)
            return loop.run_until_complete(coro_fn(*args))
        except Exception as exc:  # noqa: BLE001 — bridge calls degrade, never raise
            logger.error("Outlook mailbox pool sync call failed: %s", exc)
            return None

    async def _claim_next_async(self) -> dict[str, Any] | None:
        factory = get_session_factory()
        async with factory() as session:
            try:
                candidates = await session.execute(
                    select(Account.id, Account.tags)
                    .where(Account.provider == PROVIDER_ID, Account.status == "active")
                    .order_by(Account.created_at.asc())
                    .limit(_CANDIDATE_LIMIT)
                )
                target_id = next(
                    (row.id for row in candidates if CONSUMED_TAG not in (row.tags or [])),
                    None,
                )
                if target_id is None:
                    return None

                result = await session.execute(
                    select(Account).where(Account.id == target_id).with_for_update(skip_locked=True)
                )
                account = result.scalar_one_or_none()
                if account is None or CONSUMED_TAG in (account.tags or []):
                    return None

                account.tags = [*(account.tags or []), CONSUMED_TAG]
                await session.commit()

                return {
                    "id": account.id,
                    "email": account.email,
                    "password": account.password,
                    "refresh_token": (account.token or account.api_key or account.refresh_token),
                    "token_data": account.provider_metadata or {},
                }
            except Exception:
                await session.rollback()
                raise

    async def mark_unusable_async(self, account_id: str, error: str) -> None:
        factory = get_session_factory()
        async with factory() as session:
            await session.execute(
                update(Account)
                .where(Account.id == account_id)
                .values(status="expired", last_error=error[:500])
            )
            await session.commit()
