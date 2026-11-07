"""Single source of truth for background-manager runtime configuration.

The ``background_manager_config`` settings row is authoritative.  The
per-key HoloNe/compression settings rows predate it and are read only as a
fallback for blobs that never carried those fields, so a stored blob always
wins and legacy installs keep their values.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from stitch_backend.domains.background_manager.schemas import (
    BackgroundManagerConfig,
    normalise_background_manager_config,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

CONFIG_KEY = "background_manager_config"

_LEGACY_FALLBACK: dict[str, str] = {
    "holoneEnabled": "holone_enabled",
    "holoneMode": "holone_mode",
    "compressionEnabled": "compressionEnabled",
    "rtkEnabled": "rtkEnabled",
    "cavemanEnabled": "cavemanEnabled",
    "cavemanLevel": "cavemanLevel",
    "inputCompressionEnabled": "inputCompressionEnabled",
    "outputCompressionEnabled": "outputCompressionEnabled",
    "preserveSystemPrompt": "preserveSystemPrompt",
    "autoTriggerThreshold": "autoTriggerThreshold",
}


async def _read_raw(session: AsyncSession) -> dict[str, Any]:
    result = await session.execute(
        text("SELECT value FROM settings WHERE key = :k"), {"k": CONFIG_KEY}
    )
    row = result.first()
    if not row or not row[0]:
        return {}
    try:
        parsed = json.loads(row[0])
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


async def load_config(session: AsyncSession) -> BackgroundManagerConfig:
    raw = await _read_raw(session)
    config = normalise_background_manager_config(raw)
    missing = {alias: key for alias, key in _LEGACY_FALLBACK.items() if alias not in raw}
    if not missing:
        return config

    from stitch_backend.domains.settings.service import SettingsService

    legacy = await SettingsService(session).get_all()
    patch = {
        alias: legacy[key]
        for alias, key in missing.items()
        if legacy.get(key) is not None
    }
    if not patch:
        return config
    return BackgroundManagerConfig.model_validate(
        {**config.model_dump(by_alias=True), **patch}
    )


async def save_config(session: AsyncSession, config: BackgroundManagerConfig) -> None:
    await session.execute(
        text(
            "INSERT INTO settings (key, value) VALUES (:k, :v) "
            "ON CONFLICT(key) DO UPDATE SET value = :v"
        ),
        {"k": CONFIG_KEY, "v": config.model_dump_json(by_alias=True)},
    )
