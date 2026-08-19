"""Per-member group usage accounting — in-memory accumulator + batched flush.

Mirrors the ``flush_last_used_at`` pattern from proxy keys: every routed
request that goes through a group-shared credential calls
:func:`record_usage`, which increments an in-memory counter.  A background
task (registered in ``main.py`` lifespan) calls :func:`flush_group_usage`
every >=60 s to upsert the batch into the ``group_usage`` table via
SQLite ``INSERT ... ON CONFLICT DO UPDATE``.

The accumulator key is ``(group_id, user_id, day)``; the value is
``[requests, tokens]``.  ``record_usage`` is a no-op when ``uid`` or
``group_id_hit`` is ``None`` (desktop / auth-disabled or non-group route).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Module-level accumulator {(group_id, user_id, day): [requests, tokens]}.
# Written by record_usage() on every routed group request; read and swapped
# by flush_group_usage() from the background task.  Never accessed per-request
# by the DB write path.
_usage_batch: dict[tuple[str, int, str], list[int]] = {}


def record_usage(
    uid: int | None,
    group_id_hit: str | None,
    tokens: int | None = None,
) -> None:
    """Increment the in-memory usage counter for a group-routed request.

    No-op when ``uid`` is ``None`` (desktop / auth-disabled) or
    ``group_id_hit`` is ``None`` (credential visible via owner or
    instance-shared, not via a group share).
    """
    if uid is None or group_id_hit is None:
        return
    day = _today()
    key = (group_id_hit, uid, day)
    entry = _usage_batch.get(key)
    if entry is None:
        entry = [0, 0]
        _usage_batch[key] = entry
    entry[0] += 1
    entry[1] += tokens or 0


async def flush_group_usage(session: AsyncSession) -> int:
    """Flush the in-memory usage batch to the ``group_usage`` table.

    Called by a background task (registered in ``main.py`` lifespan) every
    >=60 seconds.  Returns the number of rows upserted.

    Uses SQLite ``INSERT ... ON CONFLICT(group_id, user_id, day) DO UPDATE``
    so concurrent flushes (or a crash mid-flush) converge to the correct
    total.  Swaps the module-level dict atomically so concurrent
    ``record_usage`` calls during the flush land in the next batch.
    """
    global _usage_batch
    if not _usage_batch:
        return 0
    # Swap atomically — concurrent record_usage() calls land in the new dict.
    batch, _usage_batch = _usage_batch, {}
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
        count += 1
    if count:
        await session.flush()
        logger.debug("GroupUsage flushed: %d rows", count)
    return count


def _today() -> str:
    """Return today's UTC date as ``'YYYY-MM-DD'``."""
    return datetime.now(UTC).strftime("%Y-%m-%d")
