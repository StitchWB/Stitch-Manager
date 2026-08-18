from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from stitch_backend.core.event_bus import event_bus
from stitch_backend.domains.ai_proxy.holone_service import get_holone_service

router = APIRouter(prefix="/holone", tags=["HoloNe Security"])


class HoloneStatusResponse(BaseModel):
    enabled: bool
    mode: str
    rule_count: int
    findings_count: int


class HoloneConfigUpdate(BaseModel):
    enabled: bool = Field(..., description="Enable or disable HoloNe inspection")
    mode: str = Field(..., description="Inspection mode: 'monitor' or 'block'")


@router.get("/status", response_model=HoloneStatusResponse)
async def holone_status() -> HoloneStatusResponse:
    """Get current HoloNe security status."""
    service = get_holone_service()
    return HoloneStatusResponse(
        enabled=service.config.enabled,
        mode=service.config.mode,
        rule_count=service.rule_count,
        findings_count=len(service._findings),
    )


@router.get("/findings")
async def holone_findings():
    """Get last 100 findings with timestamps."""
    service = get_holone_service()
    return {"findings": service.findings}


@router.post("/config")
async def holone_config_update(body: HoloneConfigUpdate):
    """Update HoloNe configuration (enabled, mode)."""
    if body.mode not in ("monitor", "block"):
        raise HTTPException(status_code=422, detail="mode must be 'monitor' or 'block'")
    service = get_holone_service()
    service.config.enabled = body.enabled
    service.config.mode = body.mode
    await event_bus.emit(
        "holone.status_changed",
        {
            "enabled": service.config.enabled,
            "mode": service.config.mode,
            "rule_count": service.rule_count,
            "findings_count": len(service._findings),
        },
    )
    return {"enabled": service.config.enabled, "mode": service.config.mode}
