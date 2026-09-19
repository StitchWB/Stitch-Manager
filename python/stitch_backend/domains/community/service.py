"""Community service — friends loader.

Stateless: friends are read from a bundled JSON file (loaded once, cached
in memory).  The AiApiRadar proxy (offers/stats + TTL cache + startup
warmup) lives in the ``stitch-radar`` service plugin.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from stitch_backend.core.exceptions import StitchError

from .models import FriendItem

logger = logging.getLogger(__name__)

# ── Friends loader ─────────────────────────────────────────────────────────────

_FRIENDS_PATH = Path(__file__).resolve().parent / "friends.json"
_friends_cache: list[dict] | None = None


def load_friends() -> list[dict]:
    """Load and validate ``friends.json`` once; return list of plain dicts.

    The file is read once on first call and cached for the process lifetime.
    Each entry is validated through :class:`FriendItem` so malformed keys
    are caught early rather than leaking to the frontend.
    """
    global _friends_cache
    if _friends_cache is not None:
        return _friends_cache

    try:
        raw = json.loads(_FRIENDS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Failed to load friends.json: %s", exc)
        raise StitchError(f"Community friends data unavailable: {exc}") from exc

    if not isinstance(raw, list):
        raise StitchError("Community friends data unavailable: expected a JSON array")

    _friends_cache = [
        FriendItem.model_validate(entry).model_dump(mode="json")
        for entry in raw
    ]
    return _friends_cache
