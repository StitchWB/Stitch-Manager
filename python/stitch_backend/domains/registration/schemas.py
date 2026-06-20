"""Pydantic schemas for the Registration domain."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class StartRegistrationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider_id: str = Field(alias="providerId")
    email: str = ""
    password: str = ""
    count: int = 1


class CancelRegistrationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    job_id: str = Field(alias="jobId")


class GetProgressRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    job_id: str | None = Field(None, alias="jobId")
