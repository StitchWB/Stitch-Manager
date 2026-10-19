"""``ai_proxy_settings`` K/V store and web-adapter settings readers."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import text

ZAI_TOKEN_DB_PATH_KEY = "zai_token_db_path"

WEB_GEMINI_ENABLED_KEY = "web_gemini_enabled"
WEB_GEMINI_ANONYMOUS_ALLOWED_KEY = "web_gemini_anonymous_allowed"

WEB_DEEPSEEK_ENABLED_KEY = "web_deepseek_enabled"

WEB_QWEN_ENABLED_KEY = "web_qwen_enabled"


def _now_ts() -> int:
    return int(time.time())


async def _ensure_settings_table(session: Any) -> None:
    """Create the ``ai_proxy_settings`` K/V table if it doesn't exist."""
    await session.execute(text(
        "CREATE TABLE IF NOT EXISTS ai_proxy_settings ("
        "  key TEXT PRIMARY KEY,"
        "  value TEXT,"
        "  updated_at INTEGER"
        ")"
    ))


def _ensure_settings_table_sync(session: Any) -> None:
    """Synchronous wrapper for ``_ensure_settings_table`` — used by command handlers."""
    import asyncio
    loop = asyncio.get_event_loop()
    loop.run_until_complete(_ensure_settings_table(session))


async def get_settings_kv(session: Any, key: str) -> str | None:
    """Read a value from ``ai_proxy_settings`` K/V table."""
    await _ensure_settings_table(session)
    result = await session.execute(
        text("SELECT value FROM ai_proxy_settings WHERE key = :k"),
        {"k": key},
    )
    row = result.fetchone()
    return row.value if row else None


def get_settings_kv_sync(session: Any, key: str) -> str | None:
    """Synchronous wrapper for ``get_settings_kv`` — used by command handlers."""
    import asyncio
    loop = asyncio.get_event_loop()
    return loop.run_until_complete(get_settings_kv(session, key))


async def set_settings_kv(session: Any, key: str, value: str) -> None:
    """Write a value to ``ai_proxy_settings`` K/V table."""
    await _ensure_settings_table(session)
    await session.execute(text(
        "INSERT OR REPLACE INTO ai_proxy_settings (key, value, updated_at)"
        " VALUES (:k, :v, :ts)"
    ), {"k": key, "v": value, "ts": _now_ts()})


def set_settings_kv_sync(session: Any, key: str, value: str) -> None:
    """Synchronous wrapper for ``set_settings_kv`` — used by command handlers."""
    import asyncio
    loop = asyncio.get_event_loop()
    loop.run_until_complete(set_settings_kv(session, key, value))


async def get_zai_token_db_path(session: Any) -> str | None:
    """Read the configured Z.AI CAPTCHA token database path."""
    return await get_settings_kv(session, ZAI_TOKEN_DB_PATH_KEY)


def get_zai_token_db_path_sync(session: Any) -> str | None:
    """Synchronous wrapper for ``get_zai_token_db_path`` — used by command handlers."""
    import asyncio
    loop = asyncio.get_event_loop()
    return loop.run_until_complete(get_zai_token_db_path(session))


async def set_zai_token_db_path(session: Any, path: str) -> None:
    """Store the Z.AI CAPTCHA token database path in settings K/V."""
    normalized_path = path.strip()
    if not normalized_path:
        raise ValueError("zai_token_db_path must not be empty")
    await set_settings_kv(session, ZAI_TOKEN_DB_PATH_KEY, normalized_path)


def set_zai_token_db_path_sync(session: Any, path: str) -> None:
    """Synchronous wrapper for ``set_zai_token_db_path`` — used by command handlers."""
    import asyncio
    loop = asyncio.get_event_loop()
    loop.run_until_complete(set_zai_token_db_path(session, path))


def _parse_bool(value: str | None, *, default: bool = True) -> bool:
    """Parse a settings K/V string into a bool. Tolerates 1/0/true/false."""
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


async def get_web_gemini_settings(session: Any) -> dict[str, bool]:
    """Read web-gemini settings from ``ai_proxy_settings`` K/V (D8).

    Defaults: ``enabled=True``, ``anonymous_allowed=True`` when keys absent.
    Tolerates ``"1"``/``"0"``/``"true"``/``"false"`` strings.
    """
    enabled_raw = await get_settings_kv(session, WEB_GEMINI_ENABLED_KEY)
    anonymous_raw = await get_settings_kv(session, WEB_GEMINI_ANONYMOUS_ALLOWED_KEY)
    return {
        "enabled": _parse_bool(enabled_raw, default=True),
        "anonymous_allowed": _parse_bool(anonymous_raw, default=True),
    }


async def get_web_deepseek_settings(session: Any) -> dict[str, bool]:
    """Read web-deepseek settings from ``ai_proxy_settings`` K/V.

    Defaults: ``enabled=True`` when the key is absent. DeepSeek web has no
    anonymous mode — the adapter is usable only with configured accounts.
    """
    enabled_raw = await get_settings_kv(session, WEB_DEEPSEEK_ENABLED_KEY)
    return {
        "enabled": _parse_bool(enabled_raw, default=True),
        "anonymous_allowed": False,
    }


async def get_web_qwen_settings(session: Any) -> dict[str, bool]:
    """Read web-qwen settings from ``ai_proxy_settings`` K/V.

    Defaults: ``enabled=True`` when the key is absent. Qwen web has no
    anonymous mode — the adapter is usable only with configured accounts.
    """
    enabled_raw = await get_settings_kv(session, WEB_QWEN_ENABLED_KEY)
    return {
        "enabled": _parse_bool(enabled_raw, default=True),
        "anonymous_allowed": False,
    }
