"""API Keys service — CRUD operations on ``ai_proxy_settings`` table.

The ``ai_proxy_settings`` table is a simple key-value store::

    key   TEXT PRIMARY KEY   — e.g. "gemini_api_keys"
    value TEXT               — JSON-encoded list of key objects
    updated_at INTEGER       — unix epoch

Each provider's keys are stored as a JSON array under a single row.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.domains.api_keys.schemas import (
    PROVIDER_DB_KEYS,
    parse_keys,
    serialize_keys,
)

logger = logging.getLogger(__name__)


class ApiKeysService:
    """Manages API key storage in the ``ai_proxy_settings`` table."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_keys(self, provider: str) -> list[dict[str, Any]]:
        """Load API keys for a provider. Returns [] if not found."""
        db_key = PROVIDER_DB_KEYS.get(provider)
        if not db_key:
            raise ValueError(f"Unknown provider: {provider}")

        result = await self._db.execute(
            text("SELECT value FROM ai_proxy_settings WHERE key = :k"),
            {"k": db_key},
        )
        row = result.first()
        if row is None:
            return []
        return parse_keys(provider, row[0])

    async def set_keys(
        self, provider: str, keys: list[dict[str, Any]],
    ) -> None:
        """Replace all API keys for a provider."""
        db_key = PROVIDER_DB_KEYS.get(provider)
        if not db_key:
            raise ValueError(f"Unknown provider: {provider}")

        json_value = serialize_keys(provider, keys)
        now = int(time.time())
        await self._db.execute(
            text(
                "INSERT OR REPLACE INTO ai_proxy_settings (key, value, updated_at) "
                "VALUES (:k, :v, :ts)"
            ),
            {"k": db_key, "v": json_value, "ts": now},
        )
        await self._db.flush()
        logger.info("[ApiKeys] Saved %d keys for provider=%s", len(keys), provider)

    async def list_providers(self) -> list[str]:
        """Return all known provider names."""
        return list(PROVIDER_DB_KEYS.keys())
