"""Dynamic custom provider management — stored in ai_proxy_settings K/V."""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CUSTOM_PROVIDERS_KEY = "custom_providers_v1"


@dataclass
class CustomProvider:
    id: str
    name: str
    base_url: str
    litellm_model: str = "openai/*"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "base_url": self.base_url,
            "litellm_model": self.litellm_model,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CustomProvider:
        return cls(
            id=data["id"],
            name=data["name"],
            base_url=data["base_url"],
            litellm_model=data.get("litellm_model", "openai/*"),
        )


async def get_custom_providers(session: AsyncSession) -> list[CustomProvider]:
    from stitch_backend.domains.api_keys.service import ApiKeysService
    svc = ApiKeysService(session)
    await svc._ensure_table()
    result = await session.execute(
        text("SELECT value FROM ai_proxy_settings WHERE key = :k"),
        {"k": CUSTOM_PROVIDERS_KEY},
    )
    row = result.first()
    if not row:
        return []
    try:
        data = json.loads(row[0])
        return [CustomProvider.from_dict(p) for p in data if isinstance(p, dict)]
    except (json.JSONDecodeError, KeyError):
        return []


async def save_custom_providers(session: AsyncSession, providers: list[CustomProvider]) -> None:
    from stitch_backend.domains.api_keys.service import ApiKeysService
    svc = ApiKeysService(session)
    await svc._ensure_table()
    json_value = json.dumps([p.to_dict() for p in providers])
    await session.execute(
        text("INSERT OR REPLACE INTO ai_proxy_settings (key, value, updated_at) VALUES (:k, :v, :ts)"),
        {"k": CUSTOM_PROVIDERS_KEY, "v": json_value, "ts": int(time.time())},
    )
    await session.flush()


async def add_custom_provider(
    session: AsyncSession, name: str, base_url: str, litellm_model: str = "openai/*"
) -> CustomProvider:
    providers = await get_custom_providers(session)
    provider = CustomProvider(
        id=uuid.uuid4().hex[:12], name=name, base_url=base_url, litellm_model=litellm_model
    )
    providers.append(provider)
    await save_custom_providers(session, providers)
    return provider


async def remove_custom_provider(session: AsyncSession, provider_id: str) -> bool:
    providers = await get_custom_providers(session)
    filtered = [p for p in providers if p.id != provider_id]
    if len(filtered) == len(providers):
        return False
    await save_custom_providers(session, filtered)
    # Remove associated keys
    from stitch_backend.domains.api_keys.service import ApiKeysService
    svc = ApiKeysService(session)
    await svc._ensure_table()
    await session.execute(
        text("DELETE FROM ai_proxy_settings WHERE key = :k"),
        {"k": f"custom_{provider_id}_api_keys"},
    )
    await session.flush()
    return True


def custom_provider_db_key(provider_id: str) -> str:
    return f"custom_{provider_id}_api_keys"