"""Per-member group usage accounting — DB-first throttled writes + batched flush.

P0.3 replaces the pure in-memory batch with a DB-first throttle:

  - ``record_usage`` is **async**.  For each ``(group_id, user_id, day)`` key
    it checks a per-key throttle dict.  When >60 s have elapsed since the
    last direct write for that key, it writes directly to the
    ``group_usage`` table via ``run_in_session`` (``INSERT … ON CONFLICT
    DO UPDATE``) and updates the throttle timestamp.  Otherwise it
    accumulates into a small ``_remainder`` dict that is drained by the
    existing 60 s background flush task.

  - The background flush task (``flush_group_usage``, registered in
    ``main.py``) is kept — it drains ``_remainder`` so writes that were
    throttled (within 60 s of the last direct write) still land in the DB.

Behavior contract preserved:
  - Quota reads unchanged (``group_usage`` table).
  - Restart loss window ~0 for throttled writes (direct writes survive
    restart; only the small ``_remainder`` since the last throttle window
    is at risk, which is ≤60 s of traffic for one key).

This module deliberately does NOT import from ``stitch_backend.domains.groups``
— the ``group_usage`` table is written via raw SQL ``text()`` so the
``ai_gateway → groups`` import edge stays cut (see P0.1 cycle break).
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Throttle window: direct DB write at most once per this many seconds per key.
_THROTTLE_SECONDS: float = 60.0

# Per-key throttle dict {key: last_write_ts}.  Checked by record_usage() to
# decide whether to do a direct DB write or accumulate into _remainder.
_throttle: dict[tuple[str, int, str], float] = {}

# Fallback accumulator for writes within the throttle window.
# {(group_id, user_id, day): [requests, tokens]}.
# Drained by flush_group_usage() from the background task.
_remainder: dict[tuple[str, int, str], list[int]] = {}

# Kept for backward compatibility with tests that inspect _usage_batch.
# Aliased to _remainder so test fixtures that clear _usage_batch also clear
# _remainder.
_usage_batch = _remainder


async def record_usage(
    uid: int | None,
    group_id_hit: str | None,
    tokens: int | None = None,
) -> None:
    """Record a group-routed request, DB-first with per-key throttle.

    No-op when ``uid`` is ``None`` (desktop / auth-disabled) or
    ``group_id_hit`` is ``None`` (credential visible via owner or
    instance-shared, not via a group share).

    When >60 s have elapsed since the last direct write for this key,
    writes directly to ``group_usage`` via ``run_in_session`` (survives
    restart).  Otherwise accumulates into ``_remainder`` (drained by the
    60 s background flush task).

    The direct write is best-effort: if ``run_in_session`` fails (DB
    unavailable, no global factory configured, etc.), the data falls back
    to ``_remainder`` so the request is never blocked by a usage-accounting
    failure.
    """
    if uid is None or group_id_hit is None:
        return
    day = _today()
    key = (group_id_hit, uid, day)
    req_delta = 1
    tok_delta = tokens or 0

    now = time.monotonic()
    last_write = _throttle.get(key)
    if last_write is not None and (now - last_write) < _THROTTLE_SECONDS:
        # Within throttle window — accumulate into _remainder.
        entry = _remainder.get(key)
        if entry is None:
            entry = [0, 0]
            _remainder[key] = entry
        entry[0] += req_delta
        entry[1] += tok_delta
        return

    # Throttle window expired (or first write for this key) — direct write.
    try:
        from stitch_backend.database import run_in_session

        async def _direct_write(session: AsyncSession) -> None:
            await session.execute(
                text(
                    "INSERT INTO group_usage (group_id, user_id, day, requests, tokens) "
                    "VALUES (:gid, :uid, :day, :req, :tok) "
                    "ON CONFLICT(group_id, user_id, day) DO UPDATE SET "
                    "requests = group_usage.requests + :req, "
                    "tokens = group_usage.tokens + :tok"
                ),
                {
                    "gid": group_id_hit,
                    "uid": uid,
                    "day": day,
                    "req": req_delta,
                    "tok": tok_delta,
                },
            )

        await run_in_session(_direct_write)
        _throttle[key] = now
    except Exception:
        # DB unavailable — fall back to _remainder so the request is not
        # blocked by a usage-accounting failure.
        entry = _remainder.get(key)
        if entry is None:
            entry = [0, 0]
            _remainder[key] = entry
        entry[0] += req_delta
        entry[1] += tok_delta
        logger.debug("Direct usage write failed, accumulated to _remainder", exc_info=True)


async def flush_group_usage(session: AsyncSession) -> int:
    """Flush the ``_remainder`` batch to the ``group_usage`` table.

    Called by a background task (registered in ``main.py`` lifespan) every
    >=60 seconds.  Returns the number of rows upserted.

    Uses SQLite ``INSERT ... ON CONFLICT(group_id, user_id, day) DO UPDATE``
    so concurrent flushes (or a crash mid-flush) converge to the correct
    total.  Swaps the module-level dict atomically so concurrent
    ``record_usage`` calls during the flush land in the next batch.
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
        count += 1
    if count:
        await session.flush()
        logger.debug("GroupUsage flushed: %d rows", count)
    return count


def _today() -> str:
    """Return today's UTC date as ``'YYYY-MM-DD'``."""
    return datetime.now(UTC).strftime("%Y-%m-%d")
