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
_POOL_SNAPSHOT_KEY = "native_gateway_key_pool_v1"


class ApiKeysService:
    """Manages API key storage in the ``ai_proxy_settings`` table."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def _ensure_table(self) -> None:
        """Ensure ``ai_proxy_settings`` table exists."""
        from stitch_backend.domains.ai_proxy.service import _ensure_settings_table
        await _ensure_settings_table(self._db)

    async def get_keys(self, provider: str) -> list[dict[str, Any]]:
        """Load API keys for a provider. Returns [] if not found."""
        db_key = PROVIDER_DB_KEYS.get(provider)
        if not db_key:
            raise ValueError(f"Unknown provider: {provider}")

        await self._ensure_table()
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
        await self._ensure_table()
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

    async def get_pool_snapshot(self) -> str | None:
        """Load the secret-free native gateway scheduler state."""
        await self._ensure_table()
        result = await self._db.execute(
            text("SELECT value FROM ai_proxy_settings WHERE key = :k"),
            {"k": _POOL_SNAPSHOT_KEY},
        )
        row = result.first()
        return None if row is None else str(row[0])

    async def set_pool_snapshot(self, snapshot: str) -> None:
        """Persist the secret-free native gateway scheduler state."""
        await self._ensure_table()
        await self._db.execute(
            text(
                "INSERT OR REPLACE INTO ai_proxy_settings (key, value, updated_at) "
                "VALUES (:k, :v, :ts)"
            ),
            {"k": _POOL_SNAPSHOT_KEY, "v": snapshot, "ts": int(time.time())},
        )
        await self._db.flush()

    async def get_keys_by_db_key(self, db_key: str) -> list[dict[str, Any]]:
        """Load API keys by raw DB key name (for custom providers)."""
        await self._ensure_table()
        result = await self._db.execute(
            text("SELECT value FROM ai_proxy_settings WHERE key = :k"),
            {"k": db_key},
        )
        row = result.first()
        if row is None:
            return []
        from stitch_backend.domains.api_keys.schemas import parse_keys
        return parse_keys("openai", row[0])

    async def set_keys_by_db_key(self, db_key: str, keys: list[dict[str, Any]]) -> None:
        """Save API keys by raw DB key name (for custom providers)."""
        from stitch_backend.domains.api_keys.schemas import serialize_keys
        json_value = serialize_keys("openai", keys)
        now = int(time.time())
        await self._ensure_table()
        await self._db.execute(
            text(
                "INSERT OR REPLACE INTO ai_proxy_settings (key, value, updated_at) "
                "VALUES (:k, :v, :ts)"
            ),
            {"k": db_key, "v": json_value, "ts": now},
        )
        await self._db.flush()
