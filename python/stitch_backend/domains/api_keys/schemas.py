"""Pydantic schemas for API key management.

Matches TypeScript interfaces generated from Rust types.
All providers share a common ``apiKey + baseUrl? + prefix?`` shape;
Anthropic adds ``customHeaders?``.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ApiKeyBase(BaseModel):
    """Common API key shape shared by Gemini, OpenAI, Antigravity, Fireworks."""

    api_key: str = Field(alias="apiKey")
    base_url: str | None = Field(default=None, alias="baseUrl")
    prefix: str | None = None

    model_config = {"populate_by_name": True}


class AnthropicApiKey(ApiKeyBase):
    """Anthropic API key — adds optional ``customHeaders``."""

    custom_headers: str | None = Field(default=None, alias="customHeaders")


# Provider → Pydantic model mapping
PROVIDER_SCHEMAS: dict[str, type[ApiKeyBase]] = {
    "gemini": ApiKeyBase,
    "openai": ApiKeyBase,
    "anthropic": AnthropicApiKey,
    "antigravity": ApiKeyBase,
    "fireworks": ApiKeyBase,
}

# Database key names in ai_proxy_settings table
PROVIDER_DB_KEYS: dict[str, str] = {
    "gemini": "gemini_api_keys",
    "openai": "openai_api_keys",
    "anthropic": "anthropic_api_keys",
    "antigravity": "antigravity_api_keys",
    "fireworks": "fireworks_api_keys",
}


def parse_keys(provider: str, raw_json: str) -> list[dict[str, Any]]:
    """Parse stored JSON into a list of API key dicts."""
    import json

    schema_cls = PROVIDER_SCHEMAS.get(provider, ApiKeyBase)
    try:
        data = json.loads(raw_json)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, list):
        return []
    result: list[dict[str, Any]] = []
    for item in data:
        try:
            obj = schema_cls.model_validate(item)
            result.append(obj.model_dump(by_alias=True))
        except Exception:
            result.append(item if isinstance(item, dict) else {"apiKey": str(item)})
    return result


def serialize_keys(provider: str, keys: list[dict[str, Any]]) -> str:
    """Serialize a list of API key dicts to JSON for storage."""
    import json

    schema_cls = PROVIDER_SCHEMAS.get(provider, ApiKeyBase)
    validated: list[dict[str, Any]] = []
    for item in keys:
        try:
            obj = schema_cls.model_validate(item)
            validated.append(obj.model_dump(by_alias=True, exclude_none=True))
        except Exception:
            validated.append(item)
    return json.dumps(validated)
