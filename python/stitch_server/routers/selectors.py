"""Selector overlay pack endpoints (plan §8 — SELECTOR-PACK channel).

  POST /admin/selectors                          — publish a selector overlay
  GET  /plugins/{plugin_id}/{version}/selectors/{selectors_version}
                                                 — fetch a selector overlay

Hot selector updates shipped WITHOUT a plugin version bump. Each publish
stores a new ``SelectorPack`` row with a per-(plugin_id, version) monotonic
``selectors_version`` (prev+1) and the sha256 of the canonical-JSON payload.
The manifest router surfaces the latest pack's version + sha for each
plugin entry so clients can decide whether to fetch a new overlay.

The overlay payload is ``{step_id: [candidate, ...]}`` — only step ids
present in the overlay are overridden on the client; absent step ids keep
their inline ``scenario.json`` candidates.
"""

from __future__ import annotations

import hashlib
import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002 — FastAPI resolves at runtime

from stitch_server.auth import has_entitlement, require_admin, require_token
from stitch_server.db import get_db
from stitch_server.models import SelectorPack, Token

router = APIRouter()


# ── Publish: POST /admin/selectors ────────────────────────────────────────────


class PublishSelectorsRequest(BaseModel):
    """Body for POST /admin/selectors."""

    plugin_id: str
    version: str
    # {step_id: [{kind, value, weight?}, ...]} — only step ids present here
    # are overridden on the client.
    selectors: dict[str, list[dict[str, Any]]]
    note: str | None = None


class PublishSelectorsResponse(BaseModel):
    plugin_id: str
    version: str
    selectors_version: int
    sha256: str
    stored: bool


def _canonical_sha256(selectors: dict[str, list[dict[str, Any]]]) -> str:
    """sha256 of the canonical-JSON encoding of the selectors payload.

    Canonical = sorted keys, no extra whitespace, ensure_ascii=False so
    CJK selector values hash the same on every host.
    """
    canonical = json.dumps(selectors, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@router.post(
    "/admin/selectors",
    response_model=PublishSelectorsResponse,
    dependencies=[Depends(require_admin)],
)
async def publish_selectors(
    req: PublishSelectorsRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PublishSelectorsResponse:
    """Store a new selector overlay pack (monotonic version bump)."""
    if not req.selectors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="selectors must be a non-empty mapping",
        )

    # Latest existing pack for this plugin@version (max selectors_version).
    prev_result = await db.execute(
        select(SelectorPack)
        .where(
            SelectorPack.plugin_id == req.plugin_id,
            SelectorPack.version == req.version,
        )
        .order_by(desc(SelectorPack.selectors_version))
        .limit(1)
    )
    prev = prev_result.scalar_one_or_none()
    next_version = (prev.selectors_version + 1) if prev is not None else 1

    sha = _canonical_sha256(req.selectors)
    pack = SelectorPack(
        plugin_id=req.plugin_id,
        version=req.version,
        selectors_version=next_version,
        payload=json.dumps(req.selectors, ensure_ascii=False),
        sha256=sha,
        note=req.note,
    )
    db.add(pack)
    await db.flush()

    return PublishSelectorsResponse(
        plugin_id=req.plugin_id,
        version=req.version,
        selectors_version=next_version,
        sha256=sha,
        stored=True,
    )


# ── Fetch: GET /plugins/{plugin_id}/{version}/selectors/{selectors_version} ──


class SelectorPackResponse(BaseModel):
    plugin_id: str
    version: str
    selectors_version: int
    selectors: dict[str, list[dict[str, Any]]]
    sha256: str


@router.get(
    "/plugins/{plugin_id}/{version}/selectors/{selectors_version}",
    response_model=SelectorPackResponse,
)
async def get_selector_pack(
    plugin_id: str,
    version: str,
    selectors_version: int,
    token: Annotated[Token, Depends(require_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SelectorPackResponse:
    """Return a stored selector overlay pack (token auth, like /plugins).

    Entitlements enforcement: 403 when the token lacks access to the plugin.
    """
    if not has_entitlement(token, plugin_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token not entitled to this plugin",
        )
    result = await db.execute(
        select(SelectorPack).where(
            SelectorPack.plugin_id == plugin_id,
            SelectorPack.version == version,
            SelectorPack.selectors_version == selectors_version,
        )
    )
    pack = result.scalar_one_or_none()
    if pack is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Selector pack not found",
        )
    return SelectorPackResponse(
        plugin_id=pack.plugin_id,
        version=pack.version,
        selectors_version=pack.selectors_version,
        selectors=json.loads(pack.payload),
        sha256=pack.sha256,
    )
