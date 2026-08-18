"""GET /manifest — signed manifest JSON.

Returns::

    {
        "server_time": "2026-08-11T12:00:00+00:00",
        "plugins": [{"id": ..., "version": ..., "rollout_percent": ..., "deprecated": [...]}],
        "signature": "ed25519:..." or null
    }

The signature is pre-computed at publish time (signing key is OFFLINE).
If no signature has been uploaded yet, ``signature`` is null; clients in
``dev_mode`` accept this (plan §3.1 item 4, §3.2 item 6).

Canary: ``rollout_percent`` is stored per plugin version; cohort selection
is CLIENT-side (``hash(token) % 100 < rollout``). The server only publishes
the number.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002 — FastAPI resolves at runtime

from stitch_server.auth import has_entitlement, require_token
from stitch_server.db import get_db
from stitch_server.models import (
    Deprecation,
    Plugin,
    PluginVersion,
    SelectorPack,
    ServerSetting,
    Token,
)

router = APIRouter()


class PluginEntry(BaseModel):
    id: str
    version: str
    rollout_percent: int
    deprecated: list[str]
    # Latest selector overlay pack for this plugin@version (plan §8).
    # 0 / empty string when no overlay has been published.
    selectors_version: int = 0
    selectors_sha256: str = ""
    # Whether this token is entitled to access this plugin (plan §3.1 item 3).
    # All plugins are returned now (marketplace browses non-entitled too);
    # the client sync skips entries where this is False.
    entitled: bool = True


class ManifestResponse(BaseModel):
    server_time: str
    plugins: list[PluginEntry]
    signature: str | None


@router.get("/manifest", response_model=ManifestResponse)
async def get_manifest(
    token: Annotated[Token, Depends(require_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ManifestResponse:
    plugins_result = await db.execute(select(Plugin))
    plugins = plugins_result.scalars().all()

    entries: list[PluginEntry] = []
    for plugin in plugins:
        # Marketplace: return ALL plugins, flagged with `entitled`.
        # Client sync skips entries where entitled is False.
        entitled = has_entitlement(token, plugin.id)
        if not plugin.current_version:
            continue
        pv_result = await db.execute(
            select(PluginVersion).where(
                PluginVersion.plugin_id == plugin.id,
                PluginVersion.version == plugin.current_version,
            )
        )
        pv = pv_result.scalar_one_or_none()
        if pv is None:
            continue
        dep_result = await db.execute(
            select(Deprecation).where(Deprecation.plugin_id == plugin.id)
        )
        deprecated = [d.versions_spec for d in dep_result.scalars().all()]

        # Latest selector overlay pack for this plugin@version (plan §8).
        # 0 / "" when no overlay has been published.
        pack_result = await db.execute(
            select(SelectorPack)
            .where(
                SelectorPack.plugin_id == plugin.id,
                SelectorPack.version == pv.version,
            )
            .order_by(SelectorPack.selectors_version.desc())
            .limit(1)
        )
        pack = pack_result.scalar_one_or_none()
        selectors_version = pack.selectors_version if pack is not None else 0
        selectors_sha256 = pack.sha256 if pack is not None else ""

        entries.append(
            PluginEntry(
                id=plugin.id,
                version=pv.version,
                rollout_percent=pv.rollout_percent,
                deprecated=deprecated,
                selectors_version=selectors_version,
                selectors_sha256=selectors_sha256,
                entitled=entitled,
            )
        )

    sig_result = await db.execute(
        select(ServerSetting).where(ServerSetting.key == "manifest_signature")
    )
    sig_row = sig_result.scalar_one_or_none()
    signature = sig_row.value if sig_row is not None else None

    return ManifestResponse(
        server_time=datetime.now(UTC).isoformat(),
        plugins=entries,
        signature=signature,
    )
