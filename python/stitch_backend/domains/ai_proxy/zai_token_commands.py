"""Z.AI token collector + health commands — register backend commands.

Exposes:
  - get_zai_token_count: returns remaining device tokens in tokens.sqlite
  - collect_zai_tokens: launches browser, collects device tokens, saves to tokens.sqlite
"""

from __future__ import annotations

import logging
from pathlib import Path

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session

logger = logging.getLogger(__name__)


@register_command("get_zai_token_count")
async def cmd_get_zai_token_count(params: dict) -> dict:
    """Return the number of device tokens in the configured tokens.sqlite."""
    from stitch_backend.domains.ai_proxy.service import get_zai_token_db_path
    from stitch_backend.domains.ai_proxy.zai_token_collector import get_token_count

    async def _op(session):
        return await get_zai_token_db_path(session)

    db_path_str = await run_in_session(_op)
    if not db_path_str:
        return {"count": 0, "configured": False}

    count = get_token_count(Path(db_path_str))
    return {"count": count, "configured": True, "path": db_path_str}


@register_command("collect_zai_tokens")
async def cmd_collect_zai_tokens(params: dict) -> dict:
    """Launch browser and collect Z.AI device tokens into tokens.sqlite.

    Params:
      count (optional): number of tokens to collect (default 750, max 1250)
    """
    from stitch_backend.domains.ai_proxy.service import get_zai_token_db_path, set_zai_token_db_path
    from stitch_backend.domains.ai_proxy.zai_token_collector import (
        DEFAULT_TOKEN_COUNT,
        TokenCollectorError,
    )
    from stitch_backend.domains.ai_proxy.zai_token_collector import (
        collect_tokens as _collect,
    )

    count = int(params.get("count", DEFAULT_TOKEN_COUNT))

    # Get or default token DB path
    async def _get_path(session):
        return await get_zai_token_db_path(session)

    db_path_str = await run_in_session(_get_path)

    if not db_path_str:
        # Default to a path in the app data directory
        from stitch_backend.config import REPO_ROOT
        db_path_str = str(REPO_ROOT / "tokens.sqlite")

        async def _set_path(session):
            await set_zai_token_db_path(session, db_path_str)

        await run_in_session(_set_path)

    db_path = Path(db_path_str)

    try:
        from autoreg.browser.patchright_engine import PatchrightEngine

        engine = PatchrightEngine(headless=True)
        result = _collect(engine, db_path, count=count)
        return {
            "success": True,
            "collected": result.collected,
            "path": result.db_path,
        }
    except TokenCollectorError as exc:
        return {"success": False, "error": exc.code, "message": str(exc)}
    except Exception as exc:
        logger.exception("Z.AI token collection failed")
        return {"success": False, "error": "internal_error", "message": str(exc)}
