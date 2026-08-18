"""Settings service — read/write key-value settings from the ``settings`` table.

The Rust backend stores each setting as a row:
    key: "emailStrategy"   value: "counter_imap"

The ``get_settings`` command reads ALL rows and returns them as a flat JSON
object (camelCase keys).  ``update_settings`` does a batch upsert.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from stitch_backend.domains.settings.models import Setting

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Matches user-scoped setting keys: "u<uid>:<original_key>"
_USER_KEY_RE = re.compile(r"^u(\d+):(.*)$")


def _user_key(owner_id: int, key: str) -> str:
    """Return the user-scoped key for ``owner_id`` and ``key``."""
    return f"u{owner_id}:{key}"

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
    # Auth policy — admin-controllable login enforcement toggle.
    "auth.enforce_login",
}
_FLOAT_KEYS = {"uiScale", "speedMultiplier"}
_JSON_KEYS = {"customIdePaths"}

PASSWORD_MASK = "********"
_PASSWORD_KEYS = {
    "imapPassword", "proxyPassword", "addyioApiToken", "gmailAppPassword",
    "icloudAppPassword", "localChatToken",
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

    async def get_all(self, owner_id: int | None = None) -> dict[str, Any]:
        """Return all settings as a flat dict (camelCase keys).

        When ``owner_id`` is given, user-scoped overrides (``u<uid>:<key>``)
        for that user are merged on top of the global keys.  When ``owner_id``
        is ``None`` (desktop), only global keys are returned — byte-identical
        to the pre-multi-user behaviour.
        """
        result = await self._db.execute(select(Setting))
        rows = result.scalars().all()

        data: dict[str, Any] = {}
        user_overrides: dict[str, str] = {}

        for row in rows:
            m = _USER_KEY_RE.match(row.key)
            if m:
                # User-scoped key — only collect if it belongs to owner_id.
                if owner_id is not None and int(m.group(1)) == owner_id:
                    user_overrides[m.group(2)] = row.value
                # Skip other users' keys entirely.
            else:
                data[row.key] = _parse_value(row.key, row.value)

        # Apply user overrides on top of global values.
        for base_key, raw_value in user_overrides.items():
            data[base_key] = _parse_value(base_key, raw_value)

        # Mask passwords
        for pk in _PASSWORD_KEYS:
            if pk in data and data[pk]:
                data[pk] = PASSWORD_MASK

        return data

    async def update(
        self, settings: dict[str, Any], owner_id: int | None = None
    ) -> dict[str, Any]:
        """Batch upsert settings.  Returns the full settings after update.

        When ``owner_id`` is given, writes go to user-scoped keys
        (``u<uid>:<key>``) ONLY — the global row is left untouched.  When
        ``owner_id`` is ``None`` (desktop), writes go to the global key —
        byte-identical to the pre-multi-user behaviour.
        """
        now = datetime.now(UTC).isoformat()
        prefix = f"u{owner_id}:" if owner_id is not None else ""

        for key, value in settings.items():
            # Skip masked passwords
            if key in _PASSWORD_KEYS and value == PASSWORD_MASK:
                continue

            raw = _serialise_value(key, value)
            db_key = f"{prefix}{key}"
            stmt = sqlite_insert(Setting).values(key=db_key, value=raw, updated_at=now)
            stmt = stmt.on_conflict_do_update(
                index_elements=["key"],
                set_={"value": raw, "updated_at": now},
            )
            await self._db.execute(stmt)

        await self._db.flush()
        return await self.get_all(owner_id=owner_id)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

from pydantic import BaseModel, ConfigDict


class GetSettingsRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class UpdateSettingsRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    settings: dict[str, Any]
