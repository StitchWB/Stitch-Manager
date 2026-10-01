"""Proxy-key services: hashed-token CRUD, constant-time resolution, batched last_used_at."""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from typing import TYPE_CHECKING

from sqlalchemy import and_, func, select

from stitch_backend.core.base_repository import BaseRepository
from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.ai_gateway.models import UserProxyKey, _utcnow

if TYPE_CHECKING:
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

# pinned to the pre-split module name so existing log routing keeps working
logger = logging.getLogger("stitch_backend.domains.ai_gateway.service")

#: Cap on enabled keys per user — resolve_proxy_key loops all enabled keys (DoS bound).
_MAX_ENABLED_KEYS_PER_USER: int = 10

#: Hard fetch LIMIT so the resolve loop stays bounded even if the table outgrows the per-user cap.
_RESOLVE_PROXY_KEY_LIMIT: int = 1000


def _hash_proxy_key(raw: str) -> str:
    """SHA256 hex of a raw proxy key — matches ``UserProxyKey.token_hash``."""
    return hashlib.sha256(raw.encode()).hexdigest()


def _mask_proxy_key(raw: str) -> str:
    """Mask a raw proxy key: first4+****+last4. Short keys → ****."""
    if len(raw) < 8:
        return "****"
    return raw[:4] + "****" + raw[-4:]


class UserProxyKeyService(BaseRepository[UserProxyKey]):
    """CRUD + resolution for :class:`UserProxyKey`.

    Raw keys are shown ONCE at creation; only the SHA256 hash is stored.
    ``last_used_at`` is batched via :func:`mark_used` (in-memory dict) and
    flushed by :func:`flush_last_used_at` from a 10 s background task — never
    written per request (avoids write-pool deadlock on pool_size=1).
    """

    _model = UserProxyKey
    _pk = "id"

    async def create_proxy_key(
        self,
        user_id: int,
        label: str | None = None,
        *,
        is_default: bool = False,
    ) -> tuple[UserProxyKey, str]:
        """Create a proxy key. Returns ``(key_row, raw_key)`` — raw shown ONCE.

        ``raw = secrets.token_hex(24)`` (48 chars). The hash is stored; the
        raw value is returned to the caller and never persisted.

        Raises :class:`StitchError` when the user already has
        ``_MAX_ENABLED_KEYS_PER_USER`` enabled keys — unbounded creation
        is a DoS vector (each enabled key is looped in
        :meth:`resolve_proxy_key`).
        """
        count_result = await self._db.execute(
            select(func.count()).select_from(UserProxyKey).where(
                UserProxyKey.user_id == user_id,
                UserProxyKey.enabled.is_(True),
            )
        )
        enabled_count = int(count_result.scalar_one())
        if enabled_count >= _MAX_ENABLED_KEYS_PER_USER:
            raise StitchError(
                f"Cannot create more than {_MAX_ENABLED_KEYS_PER_USER} "
                f"enabled proxy keys (user has {enabled_count}). "
                f"Revoke an existing key first."
            )

        raw = secrets.token_hex(24)
        token_hash = _hash_proxy_key(raw)
        record = UserProxyKey(
            user_id=user_id,
            label=label,
            token_hash=token_hash,
            enabled=True,
            is_default=is_default,
            created_at=_utcnow(),
        )
        self._db.add(record)
        await self._db.flush()
        logger.info(
            "ProxyKey created: user=%s id=%s default=%s",
            user_id, record.id, is_default,
        )
        return record, raw

    async def list_proxy_keys(self, user_id: int) -> list[UserProxyKey]:
        """Return all proxy keys for *user_id* (enabled + disabled)."""
        result = await self._db.execute(
            select(UserProxyKey)
            .where(UserProxyKey.user_id == user_id)
            .order_by(UserProxyKey.created_at.asc())
        )
        return list(result.scalars().all())

    async def revoke_proxy_key(
        self, key_id: str, user_id: int,
    ) -> bool:
        """Disable a proxy key (own only). Returns True if revoked.

        The default key is revokable only if another enabled key exists.
        """
        result = await self._db.execute(
            select(UserProxyKey).where(
                and_(
                    UserProxyKey.id == key_id,
                    UserProxyKey.user_id == user_id,
                )
            )
        )
        key = result.scalar_one_or_none()
        if key is None:
            raise StitchError("Proxy key not found")

        if key.is_default:
            count_result = await self._db.execute(
                select(UserProxyKey).where(
                    and_(
                        UserProxyKey.user_id == user_id,
                        UserProxyKey.enabled.is_(True),
                        UserProxyKey.id != key_id,
                    )
                )
            )
            other_enabled = list(count_result.scalars().all())
            if not other_enabled:
                raise StitchError(
                    "Cannot revoke the default key without another enabled key"
                )

        key.enabled = False
        await self._db.flush()
        logger.info("ProxyKey revoked: user=%s id=%s", user_id, key_id)
        return True

    async def resolve_proxy_key(self, raw: str) -> int | None:
        """Resolve a raw proxy key to a user_id (enabled keys only).

        P1.9: fetches all enabled keys and loops with
        ``hmac.compare_digest`` in Python, not a SQL equality
        match on the hash.  Keys per user are few (typically 1–3),
        so the loop is cheap and removes the timing side-channel of
        a SQL ``=`` short-circuit (which reveals whether a candidate
        hash exists in the table).

        The join on ``auth_users`` ensures the owning user still
        exists — a deleted user's keys are CASCADE-deleted
        (``ForeignKey(..., ondelete="CASCADE")`` on
        ``UserProxyKey.user_id``), so the join is belt-and-suspenders.

        Updates the in-memory ``last_used_at`` batch via
        :func:`mark_used` — never writes to the DB per request.
        """
        if not raw:
            return None
        token_hash = _hash_proxy_key(raw)
        # join on auth_users is belt-and-suspenders (CASCADE removes orphans); LIMIT keeps the loop bounded
        from stitch_backend.domains.auth.models import User

        result = await self._db.execute(
            select(UserProxyKey).join(
                User, UserProxyKey.user_id == User.id
            ).where(
                UserProxyKey.enabled.is_(True)
            ).limit(_RESOLVE_PROXY_KEY_LIMIT)
        )
        keys = result.scalars().all()
        for key in keys:
            if hmac.compare_digest(key.token_hash, token_hash):
                await mark_used(key.id)
                return key.user_id
        return None

    async def ensure_default_key(self, user_id: int) -> tuple[UserProxyKey, str] | None:
        """Ensure the user has at least one enabled key; create a default if none.

        Returns ``(key_row, raw_key)`` when a new default was created, or
        ``None`` when the user already has an enabled key.
        """
        existing = await self.list_proxy_keys(user_id)
        has_enabled = any(k.enabled for k in existing)
        if has_enabled:
            return None
        return await self.create_proxy_key(
            user_id, label="default", is_default=True,
        )


# Accumulate-only store — the request path must not open a session (pool_size=1 deadlock); see mark_used.
_last_used_batch: dict[str, datetime] = {}


async def mark_used(key_id: str) -> None:
    """Mark a proxy key as used — in-memory accumulate only.

    The request path MUST NOT open a new DB session: ``resolve_proxy_key``
    is called inside ``get_db()`` (a write session on the pool_size=1
    pool), and ``run_in_session`` would try to check out a second write
    connection → 30 s pool-timeout deadlock.  This function therefore only
    accumulates into ``_last_used_batch``; the 10 s background flush task
    (``flush_last_used_at``) performs the DB UPDATE outside any request
    session.

    Restart loss window: ≤10 s of ``last_used_at`` updates (the flush
    interval).  ``last_used_at`` is a telemetry field, not accounting —
    losing ≤10 s on restart is acceptable.
    """
    _last_used_batch[key_id] = _utcnow()


async def flush_last_used_at(session: AsyncSession) -> int:
    """Flush the ``_last_used_batch`` accumulator to the DB.

    Called by a background task (registered in ``main.py`` lifespan) every
    10 seconds.  Returns the number of keys updated.

    Swaps the module-level dict atomically (so concurrent mark_used calls
    during the flush land in the next batch, not lost).
    """
    global _last_used_batch
    if not _last_used_batch:
        return 0
    # Swap atomically — concurrent mark_used() calls land in the new dict.
    batch, _last_used_batch = _last_used_batch, {}
    count = 0
    for key_id, ts in batch.items():
        result = await session.execute(
            select(UserProxyKey).where(UserProxyKey.id == key_id)
        )
        key = result.scalar_one_or_none()
        if key is not None:
            key.last_used_at = ts
            count += 1
    if count:
        await session.flush()
        logger.debug("ProxyKey last_used_at flushed: %d keys", count)
    return count
