"""Read-only routing status schemas for the rb/* role chains."""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 — pydantic resolves annotations at runtime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class GatewayRuntimeStatusResponse(BaseModel):
    """Small runtime summary for the embedded OpenAI-compatible gateway."""

    model_config = ConfigDict(populate_by_name=True)

    running: bool
    base_url: str = Field(alias="baseUrl")
    port: int


class RoleChainAccessSummaryResponse(BaseModel):
    """Aggregated exact credential/model evidence for one chain step."""

    model_config = ConfigDict(populate_by_name=True)

    available: int = 0
    denied: int = 0
    temporarily_unavailable: int = Field(0, alias="temporarilyUnavailable")
    unknown: int = 0
    next_probe_at: datetime | None = Field(None, alias="nextProbeAt")
    last_verified_at: datetime | None = Field(None, alias="lastVerifiedAt")


class RoleChainStepStatusResponse(BaseModel):
    """Desired chain step joined with its materialized runtime target."""

    model_config = ConfigDict(populate_by_name=True)

    entry_id: str | None = Field(None, alias="entryId")
    ordinal: int
    desired_enabled: bool = Field(alias="desiredEnabled")
    source: str
    endpoint_selector: str = Field(alias="endpointSelector")
    upstream_model_key: str = Field(alias="upstreamModelKey")
    family: str | None = None

    endpoint_id: str | None = Field(None, alias="endpointId")
    endpoint_name: str | None = Field(None, alias="endpointName")
    endpoint_base_url: str | None = Field(None, alias="endpointBaseUrl")
    endpoint_enabled: bool | None = Field(None, alias="endpointEnabled")
    endpoint_circuit_state: str | None = Field(None, alias="endpointCircuitState")

    upstream_row_id: str | None = Field(None, alias="upstreamRowId")
    upstream_enabled: bool | None = Field(None, alias="upstreamEnabled")

    route_target_id: int | None = Field(None, alias="routeTargetId")
    route_enabled: bool | None = Field(None, alias="routeEnabled")
    priority: int | None = None
    managed_by: str | None = Field(None, alias="managedBy")
    lifecycle_status: str | None = Field(None, alias="lifecycleStatus")
    lifecycle_reason: str | None = Field(None, alias="lifecycleReason")
    lifecycle_updated_at: datetime | None = Field(None, alias="lifecycleUpdatedAt")

    state: str
    is_current: bool = Field(False, alias="isCurrent")
    access: RoleChainAccessSummaryResponse


class RoleRoutingStatusResponse(BaseModel):
    """One rb/* role with its ordered upstream chain."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    display_name: str | None = Field(None, alias="displayName")
    enabled: bool
    contract: dict[str, Any] | None = None
    state: str
    rotation_detected: bool = Field(False, alias="rotationDetected")
    rotation: dict[str, Any] | None = None
    total_steps: int = Field(alias="totalSteps")
    active_steps: int = Field(alias="activeSteps")
    probing_steps: int = Field(alias="probingSteps")
    demoted_steps: int = Field(alias="demotedSteps")
    steps: list[RoleChainStepStatusResponse]


class AiGatewayRoutingStatusResponse(BaseModel):
    """Gateway runtime summary plus all visible rb/* role chains."""

    model_config = ConfigDict(populate_by_name=True)

    gateway: GatewayRuntimeStatusResponse
    roles: list[RoleRoutingStatusResponse]
    generated_at: datetime = Field(alias="generatedAt")
