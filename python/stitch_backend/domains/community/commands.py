"""Community command handlers — friends directory.

``get_radar_offers`` / ``get_radar_stats`` are served by the
``stitch-radar`` plugin via the dual route (see
``plugin_runtime/radar_dual.py``).
"""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command

from .service import load_friends


@register_command("get_friends", readonly=True)
async def cmd_get_friends(params: dict) -> dict:
    """Return the community friends/channels directory."""
    return {"items": load_friends()}
