"""Compression API endpoints for UI integration."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .service import get_compression_service

router = APIRouter(prefix="/compression", tags=["Compression"])


class CompressionStatusResponse(BaseModel):
    enabled: bool
    rtk_enabled: bool
    caveman_enabled: bool
    caveman_level: str
    input_compression_enabled: bool
    output_compression_enabled: bool
    preserve_system_prompt: bool
    auto_trigger_threshold: int


class CompressionStatsResponse(BaseModel):
    requests: int
    tokens_saved: int
    input_tokens_saved: int
    output_tokens_saved: int
    avg_savings_pct: float


class CompressionConfigUpdate(BaseModel):
    enabled: bool = Field(..., description="Enable or disable compression layer")
    rtk_enabled: bool = Field(True, description="Enable RTK stdout filters")
    caveman_enabled: bool = Field(True, description="Enable Caveman token compression")
    caveman_level: str = Field("full", description="Caveman level: 'lite', 'full', or 'ultra'")
    input_compression_enabled: bool = Field(True, description="Compress input prompts")
    output_compression_enabled: bool = Field(True, description="Compress output responses")
    preserve_system_prompt: bool = Field(True, description="Preserve system messages unchanged")
    auto_trigger_threshold: int = Field(
        500, description="Min tokens to trigger compression", ge=0, le=10000
    )


@router.get("/status", response_model=CompressionStatusResponse)
async def compression_status() -> CompressionStatusResponse:
    """Get current compression configuration."""
    service = get_compression_service()
    return CompressionStatusResponse(
        enabled=service.config.enabled,
        rtk_enabled=service.config.rtk_enabled,
        caveman_enabled=service.config.caveman_enabled,
        caveman_level=service.config.caveman_level,
        input_compression_enabled=service.config.input_compression_enabled,
        output_compression_enabled=service.config.output_compression_enabled,
        preserve_system_prompt=service.config.preserve_system_prompt,
        auto_trigger_threshold=service.config.auto_trigger_threshold,
    )


@router.get("/stats", response_model=CompressionStatsResponse)
async def compression_stats() -> CompressionStatsResponse:
    """Get compression statistics."""
    service = get_compression_service()
    stats = service.stats
    return CompressionStatsResponse(**stats)


@router.post("/config")
async def compression_config_update(body: CompressionConfigUpdate):
    """Update compression configuration."""
    if body.caveman_level not in ("lite", "full", "ultra"):
        raise HTTPException(
            status_code=422,
            detail="caveman_level must be 'lite', 'full', or 'ultra'",
        )
    service = get_compression_service()
    service.config.enabled = body.enabled
    service.config.rtk_enabled = body.rtk_enabled
    service.config.caveman_enabled = body.caveman_enabled
    service.config.caveman_level = body.caveman_level
    service.config.input_compression_enabled = body.input_compression_enabled
    service.config.output_compression_enabled = body.output_compression_enabled
    service.config.preserve_system_prompt = body.preserve_system_prompt
    service.config.auto_trigger_threshold = body.auto_trigger_threshold
    return {
        "enabled": service.config.enabled,
        "rtk_enabled": service.config.rtk_enabled,
        "caveman_enabled": service.config.caveman_enabled,
        "caveman_level": service.config.caveman_level,
        "input_compression_enabled": service.config.input_compression_enabled,
        "output_compression_enabled": service.config.output_compression_enabled,
        "preserve_system_prompt": service.config.preserve_system_prompt,
        "auto_trigger_threshold": service.config.auto_trigger_threshold,
    }
