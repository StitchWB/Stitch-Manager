"""Per-member per-model group usage accounting — in-memory accumulate, batched flush.

The request path (``record_usage``) ONLY accumulates into the in-memory
``_remainder`` dict — it NEVER calls ``run_in_session``.  This is critical:
``record_usage`` is called from the LiteLLM executor inside a ``get_db()``
write session (pool_size=1, max_overflow=0).  Opening a second write
session via ``run_in_session`` would try to check out a second connection
from the same pool → 30 s pool-timeout deadlock.

The 10 s background flush task (``flush_group_usage``, registered in
``main.py`` lifespan) performs the DB upserts into ``group_usage_by_model``
outside any request session.  After each key's upsert it evaluates the
group's quota rules (``groups.quota.evaluate_quota``) and sets a
module-level ``_over_keys`` flag when a rule trips:
``(group_id, user_id, model, day)`` for member rules,
``(group_id, None, model, day)`` for pool rules.

In-process quota race (P2):
  - ``routing_engine._over_quota_group_ids`` consults ``_over_keys`` in
    addition to the DB pre-check, giving immediate visibility after a
    flush commits.  Flags are keyed by the CONCRETE model just recorded;
    a NULL/glob-model rule that trips flags only that model — other
    models are covered by the DB pre-check within one flush interval.
  - Cross-process (multi-worker) stays bounded by the DB pre-check
    (documented).

Restart loss window: ≤10 s of usage data (the flush interval).  Usage
accounting is best-effort telemetry; losing ≤10 s on restart is acceptable.

This module lazily imports ``stitch_backend.domains.groups`` inside the
flush path only — the ``ai_gateway → groups`` module-level edge stays cut
(see P0.1 cycle break).
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
# {(group_id, user_id, model, day): [requests, tokens]}.
# Drained by flush_group_usage() from the 10 s background flush task.
_remainder: dict[tuple[str, int, str, str], list[int]] = {}

# In-process over-quota flags, set by flush_group_usage after each key's
# upsert when a quota rule trips.  Consulted by
# routing_engine._over_quota_group_ids for immediate in-process
# visibility — closes the in-process TOCTOU race to zero.  Keyed by
# (group_id, user_id, model, day) for member rules and
# (group_id, None, model, day) for pool rules; cleared daily by the day
# component rotating.
_over_keys: dict[tuple[str, int | None, str, str], bool] = {}


async def record_usage(
    uid: int | None,
    group_id_hit: str | None,
    model: str | None = None,
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
    key = (group_id_hit, uid, model or "", _today())
    entry = _remainder.get(key)
    if entry is None:
        entry = [0, 0]
        _remainder[key] = entry
    entry[0] += 1
    entry[1] += tokens or 0


async def flush_group_usage(session: AsyncSession) -> int:
    """Flush the ``_remainder`` batch to the ``group_usage_by_model`` table.

    Called by a background task (registered in ``main.py`` lifespan) every
    10 seconds.  Returns the number of rows upserted.

    Uses SQLite ``INSERT ... ON CONFLICT(group_id, user_id, model, day) DO
    UPDATE`` so concurrent flushes (or a crash mid-flush) converge to the
    correct total.  Swaps the module-level dict atomically so concurrent
    ``record_usage`` calls during the flush land in the next batch.

    After each key's upsert, evaluates the group's quota rules
    (member + pool) and sets the ``_over_keys`` flag when one trips, so
    ``routing_engine._over_quota_group_ids`` sees over-quota immediately
    (in-process visibility, no DB query needed).
    """
    global _remainder
    # Prune stale _over_keys entries (day < today).  Runs even when the
    # batch is empty so the dict is cleaned on every flush tick.
    # Safe (no concurrent-modification error) because all access to
    # _over_keys is single-threaded async — record_usage only appends,
    # and there is no await between the list comprehension (iterate) and
    # the del loop (delete), so no coroutine can interleave and mutate
    # the dict mid-prune.
    today = _today()
    stale = [k for k in _over_keys if k[3] < today]
    for k in stale:
        del _over_keys[k]

    if not _remainder:
        return 0
    # Swap atomically — concurrent record_usage() calls land in the new dict.
    batch, _remainder = _remainder, {}
    count = 0
    # Per-flush cache: rules/groups are reloaded at most once per group,
    # not once per usage key.
    group_cache: dict[str, tuple] = {}
    for (group_id, user_id, model, day), (requests, tokens) in batch.items():
        await session.execute(
            text(
                "INSERT INTO group_usage_by_model "
                "(group_id, user_id, model, day, requests, tokens) "
                "VALUES (:gid, :uid, :model, :day, :req, :tok) "
                "ON CONFLICT(group_id, user_id, model, day) DO UPDATE SET "
                "requests = group_usage_by_model.requests + :req, "
                "tokens = group_usage_by_model.tokens + :tok"
            ),
            {
                "gid": group_id,
                "uid": user_id,
                "model": model,
                "day": day,
                "req": requests,
                "tok": tokens,
            },
        )
        await _flag_over_quota(session, group_id, user_id, model, day, group_cache)
        count += 1
    if count:
        await session.flush()
        logger.debug("GroupUsageByModel flushed: %d rows", count)
    return count


async def _flag_over_quota(
    session: AsyncSession,
    group_id: str,
    user_id: int,
    model: str,
    day: str,
    group_cache: dict,
) -> None:
    """Evaluate quota rules for the just-flushed key and set _over_keys.

    Member-rule hit → ``(group_id, user_id, model, day)``; pool-rule hit
    → ``(group_id, None, model, day)``.  ``group_cache`` maps group_id →
    ``(Group, rules) | None`` so a flush batch loads each group at most
    once.  Failures here must not break the flush (usage rows are already
    upserted) — log and move on.
    """
    try:
        # Lazy import — keeps the ai_gateway → groups module edge cut.
        from sqlalchemy import select

        from stitch_backend.domains.groups.models import Group
        from stitch_backend.domains.groups.quota import evaluate_quota, rules_for_group

        if group_id not in group_cache:
            group = (
                await session.execute(select(Group).where(Group.id == group_id))
            ).scalar_one_or_none()
            if group is None:
                group_cache[group_id] = None
            else:
                rules = await rules_for_group(session, group)
                group_cache[group_id] = (group, rules)
        cached = group_cache[group_id]
        if cached is None:
            return
        group, rules = cached
        verdict = await evaluate_quota(
            session, group=group, user_id=user_id, model=model, rules=rules, today=day,
        )
        if verdict.over and verdict.hit is not None:
            if verdict.hit.subject == "pool":
                _over_keys[(group_id, None, model, day)] = True
            else:
                _over_keys[(group_id, user_id, model, day)] = True
    except Exception:  # noqa: BLE001
        logger.warning(
            "Over-quota flag evaluation failed for group=%s user=%s model=%s",
            group_id, user_id, model, exc_info=True,
        )


def _today() -> str:
    """Return today's UTC date as ``'YYYY-MM-DD'``."""
    return datetime.now(UTC).strftime("%Y-%m-%d")


async def migrate_legacy_group_usage(session: AsyncSession) -> int:
    """Copy ``group_usage`` rows into ``group_usage_by_model`` (model='').

    Idempotent (INSERT OR IGNORE), runs at startup.  Returns the number
    of rows copied.  The legacy table is kept for history but no longer
    written.
    """
    result = await session.execute(
        text(
            "INSERT OR IGNORE INTO group_usage_by_model "
            "(group_id, user_id, model, day, requests, tokens) "
            "SELECT group_id, user_id, '', day, requests, tokens "
            "FROM group_usage"
        )
    )
    copied = int(getattr(result, "rowcount", 0) or 0)
    if copied:
        await session.flush()
        logger.info("Migrated %d group_usage rows to group_usage_by_model", copied)
    return int(copied)
