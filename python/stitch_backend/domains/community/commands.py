"""Community command handlers — friends directory + AiApiRadar proxy.

Three read-only commands wired to the command registry:

  - ``get_friends``       → static friends list from ``friends.json``
  - ``get_radar_offers``  → proxied ``GET /api/offers`` (validated params)
  - ``get_radar_stats``   → proxied ``GET /api/stats``
"""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command

from .models import RadarOffersParams
from .service import fetch_radar_offers, fetch_radar_stats, load_friends


@register_command("get_friends", readonly=True)
async def cmd_get_friends(params: dict) -> dict:
    """Return the community friends/channels directory."""
    return {"items": load_friends()}


@register_command("get_radar_offers", readonly=True)
async def cmd_get_radar_offers(params: dict) -> dict:
    """Proxy AiApiRadar ``GET /api/offers`` with validated query params.

    ``ValidationError`` propagates to the dispatcher which maps it to 400.
    """
    validated = RadarOffersParams.model_validate(params)
    return await fetch_radar_offers(validated)


@register_command("get_radar_stats", readonly=True)
async def cmd_get_radar_stats(params: dict) -> dict:
    """Proxy AiApiRadar ``GET /api/stats`` (no params)."""
    return await fetch_radar_stats()
