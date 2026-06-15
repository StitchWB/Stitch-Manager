"""SSO cache — write session data for IDE SSO login bypass.

Some IDEs (Kiro, Windsurf) use SSO sessions that can be pre-populated
to skip the interactive login step.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


SSO_CACHE_DIRS = {
    "kiro": Path.home() / ".kiro" / "sso",
    "windsurf": Path.home() / ".windsurf" / "sso",
}


async def write_sso_cache(
    ide: str,
    account_id: str,
    session_data: dict[str, Any],
) -> dict[str, Any]:
    """Write SSO session data so the IDE picks it up on next launch."""
    cache_dir = SSO_CACHE_DIRS.get(ide)
    if not cache_dir:
        return {"success": False, "error": f"No SSO cache for IDE: {ide}"}

    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_file = cache_dir / f"{account_id}.json"
        cache_file.write_text(json.dumps(session_data, indent=2), encoding="utf-8")
        logger.info("SSO cache written for %s/%s", ide, account_id)
        return {"success": True}
    except Exception as exc:
        logger.exception("Failed to write SSO cache")
        return {"success": False, "error": str(exc)}


async def clear_sso_cache(ide: str, account_id: str | None = None) -> dict[str, Any]:
    """Clear SSO cache for an IDE (optionally for a specific account)."""
    cache_dir = SSO_CACHE_DIRS.get(ide)
    if not cache_dir or not cache_dir.exists():
        return {"success": True, "cleared": 0}

    count = 0
    for f in cache_dir.glob("*.json"):
        if account_id is None or account_id in f.name:
            f.unlink()
            count += 1

    logger.info("SSO cache cleared: %d file(s) for %s", count, ide)
    return {"success": True, "cleared": count}
