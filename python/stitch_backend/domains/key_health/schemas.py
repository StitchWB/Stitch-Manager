"""Pydantic request schemas for the key_health domain commands.

Per the project's type-validation convention, incoming params are validated
through Pydantic models with ``populate_by_name=True`` and aliases so both
camelCase (frontend-native) and snake_case keys are accepted on the way in.
The dispatcher handles camelCase conversion automatically on the way out.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class TestProviderKeysRequest(BaseModel):
    """Request body for ``test_provider_keys``.

    Accepts either ``providerId`` (camelCase alias) or ``provider_id``
    (snake_case field name) — both resolve to the same field.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider_id: str | None = Field(default=None, alias="providerId")


class UpdateKeyHealthSettingsRequest(BaseModel):
    """Request body for ``update_key_health_settings``.

    Accepts either ``intervalSeconds`` (camelCase alias) or
    ``interval_seconds`` (snake_case field name). ``enabled`` is the same
    in both cases. Fields default to ``None`` so the caller can update just
    one setting without clobbering the other.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    interval_seconds: int | None = Field(
        default=None, alias="intervalSeconds", ge=1, le=86_400,
    )
    enabled: bool | None = Field(default=None)
