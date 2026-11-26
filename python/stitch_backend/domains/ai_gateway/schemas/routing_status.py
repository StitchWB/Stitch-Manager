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


class SupplierIntegrityResponse(BaseModel):
    """Endpoint-level fabrication share across all probed upstream models.

    Purely observational: a high share means the supplier's usage accounting
    is fabricated at scale, which is a trust signal for the operator — never
    a routing input.
    """

    model_config = ConfigDict(populate_by_name=True)

    probed_models: int = Field(0, alias="probedModels")
    fabrication_suspect_models: int = Field(0, alias="fabricationSuspectModels")
    fabrication_share: float = Field(0.0, alias="fabricationShare")


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

    # ── Trust evidence (observability-only; never a routing input) ─────────
    trust_state: str = Field("untested", alias="trustState")
    coherence_passed: bool | None = Field(None, alias="coherencePassed")
    level2_passed: bool | None = Field(None, alias="level2Passed")
    usage_sane: bool | None = Field(None, alias="usageSane")
    usage_reason: str | None = Field(None, alias="usageReason")
    evidence_tier: str | None = Field(None, alias="evidenceTier")
    probe_latency_ms: int | None = Field(None, alias="probeLatencyMs")
    probed_at: str | None = Field(None, alias="probedAt")
    usage_suspicion_count: int = Field(0, alias="usageSuspicionCount")
    usage_suspicion_reasons: list[str] = Field(default_factory=list, alias="usageSuspicionReasons")
    supplier_integrity: SupplierIntegrityResponse | None = Field(None, alias="supplierIntegrity")


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
