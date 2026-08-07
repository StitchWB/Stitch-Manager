"""Settings service — read/write key-value settings from the ``settings`` table.

The Rust backend stores each setting as a row:
    key: "emailStrategy"   value: "counter_imap"

The ``get_settings`` command reads ALL rows and returns them as a flat JSON
object (camelCase keys).  ``update_settings`` does a batch upsert.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from stitch_backend.domains.settings.models import Setting

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ── Type coercion map ─────────────────────────────────────────────────────────
# Keys whose values should be parsed as int / bool / float / json
_INT_KEYS = {
    "imapPort", "count", "passwordLength", "captchaTimeout",
    "verificationCodeTimeout", "oauthCallbackTimeout", "allowAccessWait",
    "pageLoadTimeout", "elementWaitTimeout", "imapPollInterval",
    "delayBetweenAccounts", "checkCreditsIntervalSeconds",
    "tokenRefreshCheckInterval", "tokenRefreshBuffer", "minActiveKiro",
    "minActiveWindsurf", "minActiveTrae",
}
_BOOL_KEYS = {
    "proxyEnabled", "proxyRotationEnabled", "addyioEnabled", "addyioAutoDelete",
    "thirtyThreeMailEnabled", "mailtmEnabled", "icloudEnabled", "headless",
    "autoRotateEnabled", "spoofMachineIdEnabled", "tokenRefreshEnabled",
    "realisticTyping", "humanDelays", "screenshotsOnError", "captchaSoundEnabled",
    "autoReplenishEnabled", "proxyList",
}
_FLOAT_KEYS = {"uiScale", "speedMultiplier"}
_JSON_KEYS = {"customIdePaths"}

PASSWORD_MASK = "********"
_PASSWORD_KEYS = {
    "imapPassword", "proxyPassword", "addyioApiToken", "gmailAppPassword",
    "icloudAppPassword",
}


def _parse_value(key: str, raw: str | None) -> Any:
    if raw is None:
        return None
    if key in _BOOL_KEYS:
        return raw.lower() in ("true", "1", "yes")
    if key in _INT_KEYS:
        try:
            return int(raw)
        except (ValueError, TypeError):
            return 0
    if key in _FLOAT_KEYS:
        try:
            return float(raw)
        except (ValueError, TypeError):
            return 0.0
    if key in _JSON_KEYS:
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return {}
    return raw


def _serialise_value(key: str, value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value) if value is not None else ""


class SettingsService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_all(self) -> dict[str, Any]:
        """Return all settings as a flat dict (camelCase keys)."""
        result = await self._db.execute(select(Setting))
        rows = result.scalars().all()
        data: dict[str, Any] = {}
        for row in rows:
            data[row.key] = _parse_value(row.key, row.value)

        # Mask passwords
        for pk in _PASSWORD_KEYS:
            if pk in data and data[pk]:
                data[pk] = PASSWORD_MASK

        return data

    async def update(self, settings: dict[str, Any]) -> dict[str, Any]:
        """Batch upsert settings.  Returns the full settings after update."""
        now = datetime.now(UTC).isoformat()

        for key, value in settings.items():
            # Skip masked passwords
            if key in _PASSWORD_KEYS and value == PASSWORD_MASK:
                continue

            raw = _serialise_value(key, value)
            stmt = sqlite_insert(Setting).values(key=key, value=raw, updated_at=now)
            stmt = stmt.on_conflict_do_update(
                index_elements=["key"],
                set_={"value": raw, "updated_at": now},
            )
            await self._db.execute(stmt)

        await self._db.flush()
        return await self.get_all()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

from pydantic import BaseModel, ConfigDict


class GetSettingsRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class UpdateSettingsRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    settings: dict[str, Any]
