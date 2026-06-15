"""Pydantic schemas for the Registration domain."""

from __future__ import annotations

from pydantic import BaseModel, Field


class StartRegistrationRequest(BaseModel):
    provider_id: str = Field(alias="providerId")
    email: str = ""
    password: str = ""
    count: int = 1


class CancelRegistrationRequest(BaseModel):
    job_id: str = Field(alias="jobId")


class GetProgressRequest(BaseModel):
    job_id: str | None = Field(None, alias="jobId")
