"""Partner-channel server client, friends seed, and member bookkeeping.

The distribution server owns the partner-channel catalog (single source of
truth, Feature 1).  This module is the backend's client:

  - :func:`load_friends` — friends directory for the web UI: server catalog
    (60 s cache) with the bundled ``friends.json`` as offline fallback.
  - :func:`seed_partner_channels` — startup migration: pushes bundled
    ``friends.json`` entries to the server, idempotent by ``url`` (the file
    is seed-only afterwards; admin CRUD is the new source of truth).
  - :func:`upsert_partner_member` / :func:`count_partner_members` — the
    ``partner_members`` bookkeeping behind the web panel.
"""

from __future__ import annotations

import logging
import os
import time
from typing import TYPE_CHECKING, Any

import httpx
from pydantic import ValidationError
from sqlalchemy import func, select

from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.plugin_distribution.config import (
    server_url,
    standalone_mode,
)

from .models import FriendItem
from .partner_models import PartnerMember
from .service import load_bundled_friends

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT = 15.0
_CACHE_TTL_SECONDS = 60.0

_channels_cache: list[dict[str, Any]] | None = None
_channels_cache_ts: float = 0.0


def _invalidate_channels_cache() -> None:
    """Test hook — drop the in-memory channel cache."""
    global _channels_cache, _channels_cache_ts
    _channels_cache = None
    _channels_cache_ts = 0.0


async def fetch_active_channels() -> list[dict[str, Any]]:
    """GET {server}/partner-channels (public endpoint), 60 s cached.

    Raises ``httpx.HTTPError`` on transport failure and ``ValueError`` on a
    malformed payload — callers decide the fallback.
    """
    global _channels_cache, _channels_cache_ts
    now = time.monotonic()
    if _channels_cache is not None and (now - _channels_cache_ts) < _CACHE_TTL_SECONDS:
        return _channels_cache
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        resp = await client.get(f"{server_url()}/partner-channels")
        resp.raise_for_status()
    body = resp.json()
    channels = body.get("channels") if isinstance(body, dict) else None
    if not isinstance(channels, list):
        raise ValueError("malformed /partner-channels payload")
    _channels_cache = channels
    _channels_cache_ts = now
    return channels


def _map_channels(channels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Validate server channels into the FriendItem contract (skip bad rows)."""
    items: list[dict[str, Any]] = []
    for ch in channels:
        try:
            items.append(FriendItem.model_validate(ch).model_dump(mode="json"))
        except ValidationError:
            logger.warning("Skipping malformed partner channel: %r", ch.get("id"))
    return items


async def load_friends() -> list[dict[str, Any]]:
    """Friends directory: server partner catalog, bundled file as fallback."""
    if not standalone_mode():
        try:
            channels = await fetch_active_channels()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Partner catalog unavailable, using bundled friends: %s", exc)
        else:
            return _map_channels(channels)
    return load_bundled_friends()


async def seed_partner_channels() -> None:
    """Push bundled ``friends.json`` entries to the server (idempotent by url).

    Never raises — startup must not fail on a seed problem.  No-op in
    standalone mode or when ``STITCH_ADMIN_KEY`` is unset.
    """
    if standalone_mode():
        return
    admin_key = os.environ.get("STITCH_ADMIN_KEY", "")
    if not admin_key:
        return
    try:
        entries = load_bundled_friends()
    except StitchError as exc:
        logger.warning("Partner seed skipped: %s", exc)
        return

    headers = {"X-Admin-Key": admin_key, "Accept": "application/json"}
    base = server_url()
    created = 0
    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
            resp = await client.get(f"{base}/admin/partner-channels", headers=headers)
            resp.raise_for_status()
            body = resp.json()
            existing = {
                ch.get("url")
                for ch in body.get("channels", [])
                if isinstance(ch, dict)
            }
            for entry in entries:
                if entry["url"] in existing:
                    continue
                resp = await client.post(
                    f"{base}/admin/partner-channels",
                    json={
                        "title": entry["title"],
                        "url": entry["url"],
                        "description": entry.get("description"),
                        "badge": entry.get("badge") or "friend",
                        "type": entry.get("type") or "telegram",
                    },
                    headers=headers,
                )
                resp.raise_for_status()
                created += 1
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Partner channel seed failed: %s", exc)
        return
    if created:
        logger.info("Partner channel seed: %d new channel(s)", created)


async def upsert_partner_member(
    db: AsyncSession,
    *,
    channel_id: str,
    user_id: int,
    invited_by_tg_id: int | None,
    granted_role: str,
) -> None:
    """Insert or refresh the (channel, user) membership row."""
    result = await db.execute(
        select(PartnerMember).where(
            PartnerMember.channel_id == channel_id,
            PartnerMember.user_id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        db.add(
            PartnerMember(
                channel_id=channel_id,
                user_id=user_id,
                invited_by_tg_id=invited_by_tg_id,
                granted_role=granted_role,
            )
        )
    else:
        row.invited_by_tg_id = invited_by_tg_id
        row.granted_role = granted_role
    await db.flush()


async def count_partner_members(db: AsyncSession, channel_id: str) -> int:
    """Number of members recorded for a channel."""
    result = await db.execute(
        select(func.count())
        .select_from(PartnerMember)
        .where(PartnerMember.channel_id == channel_id)
    )
    return int(result.scalar_one())
