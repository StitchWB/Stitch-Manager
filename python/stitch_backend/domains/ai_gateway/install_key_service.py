"""Install-scoped proxy-key service: hashed-token CRUD, constant-time resolution, batched last_used_at."""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select

from stitch_backend.core.base_repository import BaseRepository
from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.ai_gateway.models import InstallProxyKey, _utcnow

if TYPE_CHECKING:
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

# pinned to the pre-split module name so existing log routing keeps working
logger = logging.getLogger("stitch_backend.domains.ai_gateway.service")

#: Cap on enabled keys per (purpose, target) — resolve_install_key loops all
#: enabled keys (DoS bound).  Install keys are few by design (one per tool).
_MAX_ENABLED_INSTALL_KEYS_PER_TARGET: int = 5

#: Hard fetch LIMIT so the resolve loop stays bounded even if the table
#: outgrows the per-target cap.
_RESOLVE_INSTALL_KEY_LIMIT: int = 100


def _hash_install_key(raw: str) -> str:
    """SHA256 hex of a raw install key — matches ``InstallProxyKey.token_hash``."""
    return hashlib.sha256(raw.encode()).hexdigest()


def install_key_fingerprint(token_hash: str) -> str:
    """Public fingerprint of a stored hash: first 8 hex chars.

    Safe to display/log: a SHA256 prefix is not reversible into the raw key
    and the raw key is never stored.
    """
    return token_hash[:8]


class InstallKeyService(BaseRepository[InstallProxyKey]):
    """CRUD + resolution for :class:`InstallProxyKey`.

    Raw keys are shown ONCE at creation; only the SHA256 hash is stored.
    ``last_used_at`` is batched via :func:`mark_install_key_used` (in-memory
    dict) and flushed by :func:`flush_install_key_last_used_at` from a 10 s
    background task — never written per request (avoids write-pool deadlock
    on pool_size=1).
    """

    _model = InstallProxyKey
    _pk = "id"

    async def create_install_key(
        self,
        purpose: str,
        target: str | None = None,
        label: str | None = None,
    ) -> tuple[InstallProxyKey, str]:
        """Create an install key. Returns ``(key_row, raw_key)`` — raw shown ONCE.

        ``raw = secrets.token_hex(24)`` (48 chars).  The hash is stored; the
        raw value is returned to the caller and never persisted.

        Raises :class:`StitchError` when the (purpose, target) pair already
        has ``_MAX_ENABLED_INSTALL_KEYS_PER_TARGET`` enabled keys — unbounded
        creation is a DoS vector (each enabled key is looped in
        :meth:`resolve_install_key`).
        """
        count_result = await self._db.execute(
            select(func.count())
            .select_from(InstallProxyKey)
            .where(
                InstallProxyKey.purpose == purpose,
                InstallProxyKey.target == target,
                InstallProxyKey.enabled.is_(True),
            )
        )
        enabled_count = int(count_result.scalar_one())
        if enabled_count >= _MAX_ENABLED_INSTALL_KEYS_PER_TARGET:
            raise StitchError(
                f"Cannot create more than {_MAX_ENABLED_INSTALL_KEYS_PER_TARGET} "
                f"enabled install keys for ({purpose!r}, {target!r}) "
                f"(has {enabled_count}). Revoke an existing key first."
            )

        raw = secrets.token_hex(24)
        token_hash = _hash_install_key(raw)
        record = InstallProxyKey(
            purpose=purpose,
            target=target,
            label=label,
            token_hash=token_hash,
            enabled=True,
            created_at=_utcnow(),
        )
        self._db.add(record)
        await self._db.flush()
        logger.info(
            "InstallKey created: purpose=%s target=%s id=%s",
            purpose,
            target,
            record.id,
        )
        return record, raw

    async def list_install_keys(
        self,
        purpose: str | None = None,
        target: str | None = None,
    ) -> list[dict[str, Any]]:
        """List install keys (enabled + disabled) as public dicts.

        NEVER returns raw keys (they are not stored — only the hash is) and
        never returns the full hash either: rows are exposed with a
        ``fingerprint`` (first 8 chars of ``token_hash``) for correlation.
        """
        stmt = select(InstallProxyKey).order_by(InstallProxyKey.created_at.asc())
        if purpose is not None:
            stmt = stmt.where(InstallProxyKey.purpose == purpose)
        if target is not None:
            stmt = stmt.where(InstallProxyKey.target == target)
        result = await self._db.execute(stmt)
        rows = list(result.scalars().all())
        return [
            {
                "id": row.id,
                "purpose": row.purpose,
                "target": row.target,
                "label": row.label,
                "enabled": row.enabled,
                "fingerprint": install_key_fingerprint(row.token_hash),
                "created_at": row.created_at,
                "revoked_at": row.revoked_at,
                "last_used_at": row.last_used_at,
            }
            for row in rows
        ]

    async def revoke_install_key(self, key_id: str) -> bool:
        """Disable an install key. Returns True if revoked.

        Raises :class:`StitchError` when the key does not exist.  Revocation
        flips ``enabled`` to False and stamps ``revoked_at`` — the row is
        kept for audit.
        """
        result = await self._db.execute(select(InstallProxyKey).where(InstallProxyKey.id == key_id))
        key = result.scalar_one_or_none()
        if key is None:
            raise StitchError("Install key not found")

        key.enabled = False
        key.revoked_at = _utcnow()
        await self._db.flush()
        logger.info("InstallKey revoked: id=%s purpose=%s", key_id, key.purpose)
        return True

    async def resolve_install_key(self, raw: str) -> InstallProxyKey | None:
        """Resolve a raw install key to its row (enabled keys only).

        Fetches enabled keys (hard-capped at ``_RESOLVE_INSTALL_KEY_LIMIT``)
        and loops with ``hmac.compare_digest`` in Python, not a SQL equality
        match on the hash — same constant-time rationale as user proxy keys
        (a SQL ``=`` short-circuit reveals whether a candidate hash exists).

        Updates the in-memory ``last_used_at`` batch via
        :func:`mark_install_key_used` — never writes to the DB per request.
        MUST be called inside the request's already-open session: opening a
        nested session here would deadlock the pool_size=1 write pool.
        """
        if not raw:
            return None
        token_hash = _hash_install_key(raw)
        result = await self._db.execute(
            select(InstallProxyKey)
            .where(InstallProxyKey.enabled.is_(True))
            .limit(_RESOLVE_INSTALL_KEY_LIMIT)
        )
        keys = result.scalars().all()
        for key in keys:
            if hmac.compare_digest(key.token_hash, token_hash):
                await mark_install_key_used(key.id)
                return key
        return None


# Accumulate-only store — the request path must not open a session (pool_size=1 deadlock); see mark_install_key_used.
_install_last_used_batch: dict[str, datetime] = {}


async def mark_install_key_used(key_id: str) -> None:
    """Mark an install key as used — in-memory accumulate only.

    The request path MUST NOT open a new DB session: install-key resolution
    runs inside the request's already-open session on the pool_size=1 write
    pool, and a nested session would try to check out a second write
    connection → 30 s pool-timeout deadlock.  This function therefore only
    accumulates into ``_install_last_used_batch``; the 10 s background flush
    task (``flush_install_key_last_used_at``) performs the DB UPDATE outside
    any request session.

    Restart loss window: ≤10 s of ``last_used_at`` updates (the flush
    interval).  ``last_used_at`` is a telemetry field, not accounting —
    losing ≤10 s on restart is acceptable.
    """
    _install_last_used_batch[key_id] = _utcnow()


async def flush_install_key_last_used_at(session: AsyncSession) -> int:
    """Flush the ``_install_last_used_batch`` accumulator to the DB.

    Called by the same background task that flushes user proxy keys
    (``workers.proxy_key_flush_loop``) every 10 seconds.  Returns the number
    of keys updated.

    Swaps the module-level dict atomically (so concurrent
    mark_install_key_used calls during the flush land in the next batch,
    not lost).
    """
    global _install_last_used_batch
    if not _install_last_used_batch:
        return 0
    # Swap atomically — concurrent mark_install_key_used() calls land in the new dict.
    batch, _install_last_used_batch = _install_last_used_batch, {}
    count = 0
    for key_id, ts in batch.items():
        result = await session.execute(select(InstallProxyKey).where(InstallProxyKey.id == key_id))
        key = result.scalar_one_or_none()
        if key is not None:
            key.last_used_at = ts
            count += 1
    if count:
        await session.flush()
        logger.debug("InstallKey last_used_at flushed: %d keys", count)
    return count
