"""CRUD service for the local community-channel catalog."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from stitch_backend.core.exceptions import StitchError

from .models import CommunityChannel

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

_VALID_TYPES = {"telegram", "discord", "github", "other"}
_VALID_BADGES = {"official", "partner", "friend"}


def _validate(payload: dict[str, Any]) -> None:
    title = payload.get("title")
    if not isinstance(title, str) or not title.strip():
        raise StitchError("Title is required")
    url = payload.get("url")
    if not isinstance(url, str) or not url.strip().startswith("http"):
        raise StitchError("URL must start with http")
    if payload.get("type", "telegram") not in _VALID_TYPES:
        raise StitchError(f"Invalid channel type: {payload.get('type')!r}")
    badge = payload.get("badge")
    if badge is not None and badge not in _VALID_BADGES:
        raise StitchError(f"Invalid channel badge: {badge!r}")


def _to_item(row: CommunityChannel) -> dict[str, Any]:
    return {
        "id": row.id,
        "title": row.title,
        "url": row.url,
        "description": row.description,
        "logo_url": row.logo_url,
        "type": row.type,
        "badge": row.badge,
        "active": row.active,
    }


async def list_channels(db: AsyncSession) -> list[dict[str, Any]]:
    """All channels, newest first."""
    result = await db.execute(
        select(CommunityChannel).order_by(CommunityChannel.created_at.desc())
    )
    return [_to_item(row) for row in result.scalars().all()]


async def get_channel(db: AsyncSession, channel_id: str) -> CommunityChannel:
    result = await db.execute(
        select(CommunityChannel).where(CommunityChannel.id == channel_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise StitchError(f"Channel not found: {channel_id}")
    return row


async def create_channel(db: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    _validate(payload)
    row = CommunityChannel(
        id=uuid.uuid4().hex,
        title=payload["title"].strip(),
        url=payload["url"].strip(),
        description=payload.get("description"),
        logo_url=payload.get("logo_url"),
        type=payload.get("type", "telegram"),
        badge=payload.get("badge"),
        active=payload.get("active", True),
    )
    db.add(row)
    await db.flush()
    return _to_item(row)


async def update_channel(
    db: AsyncSession, channel_id: str, payload: dict[str, Any]
) -> dict[str, Any]:
    row = await get_channel(db, channel_id)
    merged = {
        "title": payload.get("title", row.title),
        "url": payload.get("url", row.url),
        "description": payload.get("description", row.description),
        "logo_url": payload.get("logo_url", row.logo_url),
        "type": payload.get("type", row.type),
        "badge": payload.get("badge", row.badge),
        "active": payload.get("active", row.active),
    }
    _validate(merged)
    row.title = merged["title"].strip()
    row.url = merged["url"].strip()
    row.description = merged["description"]
    row.logo_url = merged["logo_url"]
    row.type = merged["type"]
    row.badge = merged["badge"]
    row.active = merged["active"]
    await db.flush()
    return _to_item(row)


async def delete_channel(db: AsyncSession, channel_id: str) -> None:
    row = await get_channel(db, channel_id)
    await db.delete(row)
    await db.flush()
