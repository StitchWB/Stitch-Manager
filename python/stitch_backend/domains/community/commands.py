"""Community command handlers — friends directory.

``get_radar_offers`` / ``get_radar_stats`` are served by the
``stitch-radar`` plugin via the dual route (see
``plugin_runtime/radar_dual.py``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from stitch_backend.core.command_decorator import command

from .partner_service import load_friends

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@command("get_friends", readonly=True)
async def cmd_get_friends(db: AsyncSession, params: dict) -> dict[str, Any]:
    """Return the community friends/channels directory."""
    return {"items": await load_friends(db)}
