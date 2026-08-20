"""Per-member group usage accounting — in-memory accumulate, batched flush.

The request path (``record_usage``) ONLY accumulates into the in-memory
``_remainder`` dict — it NEVER calls ``run_in_session``.  This is critical:
``record_usage`` is called from the LiteLLM executor inside a ``get_db()``
write session (pool_size=1, max_overflow=0).  Opening a second write
session via ``run_in_session`` would try to check out a second connection
from the same pool → 30 s pool-timeout deadlock.

The 10 s background flush task (``flush_group_usage``, registered in
``main.py`` lifespan) performs the DB upserts outside any request session.
After each key's upsert it re-reads the post-increment ``requests`` count
and the group's ``max_requests_per_member_daily`` cap within the same
transaction; when ``requests >= cap`` it sets the module-level
``_over_keys`` flag for the ``(group_id, user_id, day)`` key.

In-process quota race (P2):
  - ``routing_engine._over_quota_group_ids`` consults ``_over_keys`` in
    addition to the DB pre-check, giving immediate in-process visibility
    after the flush commits.  This closes the in-process TOCTOU race to
    zero (the DB pre-check alone has a read→write gap).  Cross-process
    (multi-worker) stays bounded by the DB pre-check (documented).

Restart loss window: ≤10 s of usage data (the flush interval).  Usage
accounting is best-effort telemetry; losing ≤10 s on restart is acceptable.

This module deliberately does NOT import from ``stitch_backend.domains.groups``
— the ``group_usage`` table is written via raw SQL ``text()`` so the
``ai_gateway → groups`` import edge stays cut (see P0.1 cycle break).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# In-memory accumulator for usage writes.  The request path ONLY
# accumulates here — NEVER calls run_in_session (which would deadlock on
# the pool_size=1 write pool when called from within a get_db() session).
# {(group_id, user_id, day): [requests, tokens]}.
# Drained by flush_group_usage() from the 10 s background flush task.
_remainder: dict[tuple[str, int, str], list[int]] = {}

# In-process over-quota flag: set by flush_group_usage after each key's
# upsert when the post-increment requests count reaches the group's
# per-member daily cap.  Consulted by routing_engine._over_quota_group_ids
# for immediate visibility within the same process — closes the in-process
# TOCTOU race to zero.  Cross-process (multi-worker) stays bounded by the
# DB pre-check (documented).  Keyed by (group_id, user_id, day); cleared
# daily by key rotation (the day component changes).
_over_keys: dict[tuple[str, int, str], bool] = {}


async def record_usage(
    uid: int | None,
    group_id_hit: str | None,
    tokens: int | None = None,
) -> None:
    """Record a group-routed request — in-memory accumulate only.

    No-op when ``uid`` is ``None`` (desktop / auth-disabled) or
    ``group_id_hit`` is ``None`` (credential visible via owner or
    instance-shared, not via a group share).

    Accumulates into ``_remainder`` (drained by the 10 s background flush
    task).  NEVER calls ``run_in_session`` — the caller (LiteLLM executor)
    is already inside a ``get_db()`` write session on the pool_size=1
    pool, and opening a second write session would deadlock.
    """
    if uid is None or group_id_hit is None:
        return
    day = _today()
    key = (group_id_hit, uid, day)
    entry = _remainder.get(key)
    if entry is None:
        entry = [0, 0]
        _remainder[key] = entry
    entry[0] += 1
    entry[1] += tokens or 0


async def flush_group_usage(session: AsyncSession) -> int:
    """Flush the ``_remainder`` batch to the ``group_usage`` table.

    Called by a background task (registered in ``main.py`` lifespan) every
    10 seconds.  Returns the number of rows upserted.

    Uses SQLite ``INSERT ... ON CONFLICT(group_id, user_id, day) DO UPDATE``
    so concurrent flushes (or a crash mid-flush) converge to the correct
    total.  Swaps the module-level dict atomically so concurrent
    ``record_usage`` calls during the flush land in the next batch.

    After each key's upsert, re-reads the post-increment ``requests`` count
    and the group's ``max_requests_per_member_daily`` cap within the same
    transaction.  When ``requests >= cap``, sets the module-level
    ``_over_keys`` flag so ``routing_engine._over_quota_group_ids`` sees
    over-quota immediately (in-process visibility, no DB query needed).
    """
    global _remainder
    if not _remainder:
        return 0
    # Swap atomically — concurrent record_usage() calls land in the new dict.
    batch, _remainder = _remainder, {}
    count = 0
    for (group_id, user_id, day), (requests, tokens) in batch.items():
        await session.execute(
            text(
                "INSERT INTO group_usage (group_id, user_id, day, requests, tokens) "
                "VALUES (:gid, :uid, :day, :req, :tok) "
                "ON CONFLICT(group_id, user_id, day) DO UPDATE SET "
                "requests = group_usage.requests + :req, "
                "tokens = group_usage.tokens + :tok"
            ),
            {
                "gid": group_id,
                "uid": user_id,
                "day": day,
                "req": requests,
                "tok": tokens,
            },
        )
        # Re-read post-increment requests and the group's cap within the
        # same transaction so the in-process _over_keys flag is accurate.
        req_row = await session.execute(
            text(
                "SELECT requests FROM group_usage "
                "WHERE group_id = :gid AND user_id = :uid AND day = :day"
            ),
            {"gid": group_id, "uid": user_id, "day": day},
        )
        post_requests = req_row.scalar_one()
        cap_row = await session.execute(
            text(
                "SELECT max_requests_per_member_daily FROM groups WHERE id = :gid"
            ),
            {"gid": group_id},
        )
        cap = cap_row.scalar_one_or_none()
        if cap is not None and post_requests >= int(cap):
            _over_keys[(group_id, user_id, day)] = True
        count += 1
    if count:
        await session.flush()
        logger.debug("GroupUsage flushed: %d rows", count)
    return count


def _today() -> str:
    """Return today's UTC date as ``'YYYY-MM-DD'``."""
    return datetime.now(UTC).strftime("%Y-%m-%d")
