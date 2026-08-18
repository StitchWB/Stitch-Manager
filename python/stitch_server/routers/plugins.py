"""GET /plugins/{id}/{version} — serve a stored pre-signed package zip.

No/invalid token → 401; revoked token → 403 (enforced by ``require_token``).
Token lacking entitlement for the plugin → 403.  The package bytes are
served as-is (pre-signed offline by the admin).

Watermarking (plan §3.2 item 7): when the publish pipeline stored N
variants for this plugin version, the server selects which variant to
serve based on ``int(token.token_hash, 16) % N`` — a deterministic
per-token mapping.  When no variants exist, the legacy
``PluginVersion.package_path`` is served (non-watermarked fallback).
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002 — FastAPI resolves at runtime

from stitch_server.auth import has_entitlement, require_token
from stitch_server.config import get_settings
from stitch_server.db import get_db
from stitch_server.models import PluginVariant, PluginVersion, Token

router = APIRouter()


@router.get("/plugins/{plugin_id}/{version}")
async def get_plugin(
    plugin_id: str,
    version: str,
    token: Annotated[Token, Depends(require_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FileResponse:
    # Entitlements enforcement: 403 when the token lacks access.
    # Ordered before any 404 so a non-entitled token cannot probe existence.
    if not has_entitlement(token, plugin_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token not entitled to this plugin",
        )

    result = await db.execute(
        select(PluginVersion).where(
            PluginVersion.plugin_id == plugin_id,
            PluginVersion.version == version,
        )
    )
    pv = result.scalar_one_or_none()
    if pv is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plugin version not found",
        )

    # Variant selection: if watermarked variants exist, pick one by token hash.
    path = await _select_package_path(pv, token, db)
    if path is None:
        # Fallback to legacy path (set during non-variant publish).
        # An empty package_path must NOT be allowed to resolve to the
        # plugins dir (Path("") / "" == ".") — that would let FileResponse
        # serve a directory and 500.  Treat empty as "no package available".
        if not pv.package_path:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Package not available for this version",
            )
        path = Path(pv.package_path)
        if not path.is_absolute():
            path = get_settings().plugins_path / path

    # Containment check: the resolved path must live inside the plugins dir.
    # Prevents any future path-injection (e.g. via a tampered package_path)
    # from serving files outside the plugins root.
    resolved = path.resolve()
    base = get_settings().plugins_path.resolve()
    if not resolved.is_relative_to(base):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package file not found on server",
        )

    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Package file not found on server",
        )
    return FileResponse(
        path=str(path),
        media_type="application/zip",
        filename=f"{plugin_id}-{version}.zip",
    )


async def _select_package_path(
    pv: PluginVersion,
    token: Token,
    db: AsyncSession,
) -> Path | None:
    """Return the package path for the token's variant, or None for legacy fallback.

    Positional selection (plan §3.2 item 7): variants are sorted by ``idx``
    and the chosen variant is ``variants[int(token.token_hash, 16) % N]``
    where ``N = len(variants)``.  This is robust when ``idx`` values are
    non-contiguous (e.g. only idx 1 and 3 exist) — the positional mapping
    still picks one deterministically.  When ``N == 0``, returns None (caller
    falls back to ``pv.package_path``).
    """
    var_result = await db.execute(
        select(PluginVariant)
        .where(PluginVariant.plugin_version_id == pv.id)
        .order_by(PluginVariant.idx)
    )
    variants = var_result.scalars().all()
    if not variants:
        return None

    n = len(variants)
    chosen = variants[int(token.token_hash, 16) % n]
    p = Path(chosen.package_path)
    if not p.is_absolute():
        p = get_settings().plugins_path / p
    return p
