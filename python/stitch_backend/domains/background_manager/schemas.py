"""Validated contracts for background-manager runtime configuration."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator


class RateLimitPolicy(BaseModel):
    """Independent request and token windows for one native gateway provider."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    provider: str = Field(min_length=1, max_length=128)
    rpm_limit: int = Field(alias="rpmLimit", ge=1)
    rpm_window_seconds: int = Field(alias="rpmWindowSeconds", ge=1, le=3_600)
    tpm_limit: int = Field(alias="tpmLimit", ge=1)
    tpm_window_seconds: int = Field(alias="tpmWindowSeconds", ge=1, le=3_600)

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, value: str) -> str:
        provider = value.strip()
        if not provider:
            raise ValueError("provider must not be blank")
        return provider


class BackgroundManagerConfig(BaseModel):
    """Persisted manager settings shared by commands and the native AI gateway."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    auto_register_enabled: bool = Field(False, alias="autoRegisterEnabled")
    register_interval_minutes: int = Field(30, alias="registerIntervalMinutes", ge=1, le=10_080)
    min_accounts_threshold: int = Field(5, alias="minAccountsThreshold", ge=0, le=1_000_000)
    auto_switch_enabled: bool = Field(False, alias="autoSwitchEnabled")
    switch_on_zero_credits: bool = Field(True, alias="switchOnZeroCredits")
    check_credits_interval_seconds: int = Field(60, alias="checkCreditsIntervalSeconds", ge=1, le=86_400)
    auto_refresh_quota_enabled: bool = Field(False, alias="autoRefreshQuotaEnabled")
    refresh_quota_interval_seconds: int = Field(300, alias="refreshQuotaIntervalSeconds", ge=1, le=86_400)
    refresh_quota_max_errors: int = Field(3, alias="refreshQuotaMaxErrors", ge=0, le=1_000)
    rotation_strategy: Literal["round-robin", "random", "least-used", "priority"] = Field(
        "round-robin", alias="rotationStrategy"
    )
    provider_priority: list[str] = Field(default_factory=list, alias="providerPriority", max_length=1_000)
    health_check_enabled: bool = Field(False, alias="healthCheckEnabled")
    health_check_interval_seconds: int = Field(300, alias="healthCheckIntervalSeconds", ge=1, le=86_400)
    health_check_auto_disable: bool = Field(True, alias="healthCheckAutoDisable")
    health_check_test_endpoint: str = Field(
        "/v1/models", alias="healthCheckTestEndpoint", min_length=1, max_length=2_048
    )
    health_check_cooldown_seconds: int = Field(3_600, alias="healthCheckCooldownSeconds", ge=0, le=604_800)
    health_check_exponential_backoff: bool = Field(False, alias="healthCheckExponentialBackoff")
    rate_limit_enabled: bool = Field(False, alias="rateLimitEnabled")
    rate_limit_reserve_percent: int = Field(0, alias="rateLimitReservePercent", ge=0, le=50)
    rate_limit_policies: list[RateLimitPolicy] = Field(
        default_factory=list, alias="rateLimitPolicies", max_length=1_000
    )
    holone_enabled: bool = Field(False, alias="holoneEnabled")
    holone_mode: str = Field("monitor", alias="holoneMode")  # "monitor" or "block"
    compression_enabled: bool = Field(False, alias="compressionEnabled")
    rtk_enabled: bool = Field(True, alias="rtkEnabled")
    caveman_enabled: bool = Field(True, alias="cavemanEnabled")
    caveman_level: str = Field("full", alias="cavemanLevel")  # "lite", "full", or "ultra"
    input_compression_enabled: bool = Field(True, alias="inputCompressionEnabled")
    output_compression_enabled: bool = Field(True, alias="outputCompressionEnabled")
    preserve_system_prompt: bool = Field(True, alias="preserveSystemPrompt")
    auto_trigger_threshold: int = Field(500, alias="autoTriggerThreshold", ge=0, le=10_000)

    @field_validator("provider_priority")
    @classmethod
    def validate_provider_priority(cls, value: list[str]) -> list[str]:
        providers = [provider.strip() for provider in value]
        if any(not provider for provider in providers):
            raise ValueError("providerPriority entries must not be blank")
        if len({provider.casefold() for provider in providers}) != len(providers):
            raise ValueError("providerPriority entries must be unique")
        return providers

    @model_validator(mode="after")
    def validate_unique_rate_policies(self) -> BackgroundManagerConfig:
        providers = [policy.provider.casefold() for policy in self.rate_limit_policies]
        if len(set(providers)) != len(providers):
            raise ValueError("rateLimitPolicies providers must be unique")
        return self


def normalise_background_manager_config(value: object) -> BackgroundManagerConfig:
    """Load legacy partial/enveloped persisted data, dropping invalid top-level fields."""
    if isinstance(value, dict) and isinstance(value.get("config"), dict):
        value = value["config"]
    if not isinstance(value, dict):
        return BackgroundManagerConfig.model_validate({})

    candidate = dict(value)
    aliases = {
        field.alias or name: name
        for name, field in BackgroundManagerConfig.model_fields.items()
    }
    for _ in range(len(candidate) + 1):
        try:
            return BackgroundManagerConfig.model_validate(candidate)
        except ValidationError as exc:
            errors = exc.errors()
            invalid_keys = {error["loc"][0] for error in errors if error.get("loc")}
            removed = False
            for invalid_key in invalid_keys:
                field_name = aliases.get(str(invalid_key), str(invalid_key))
                field = BackgroundManagerConfig.model_fields.get(field_name)
                keys = {field_name, field.alias if field is not None else None}
                for key in keys:
                    if key is not None and key in candidate:
                        candidate.pop(key)
                        removed = True
            if not removed:
                break
    return BackgroundManagerConfig.model_validate({})
