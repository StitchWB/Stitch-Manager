"""Pydantic schemas for the Registration domain."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from autoreg.provider_ids import ProviderId


class StartRegistrationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider_id: str = Field(alias="providerId")
    email: str = ""
    password: str = ""
    count: int = 1

    @field_validator("provider_id")
    @classmethod
    def validate_provider_id(cls, v: str) -> str:
        try:
            ProviderId(v)
        except ValueError:
            raise ValueError(
                f"Unknown provider id: {v!r}. "
                f"Valid values: {[p.value for p in ProviderId]}"
            ) from None
        return v


class CancelRegistrationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    job_id: str = Field(alias="jobId")


class GetProgressRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    job_id: str | None = Field(None, alias="jobId")
