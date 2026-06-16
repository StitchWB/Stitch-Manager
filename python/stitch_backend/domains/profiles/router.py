"""REST API endpoints for the Profiles domain.

Provides clean RESTful routes alongside the legacy RPC commands.
The frontend can migrate to these endpoints incrementally.

Routes (mounted at ``/api/v1/profiles``):
  GET    /fingerprints          — list all fingerprint aliases
  GET    /fingerprints/{email}  — load a fingerprint profile
  POST   /fingerprints/generate — generate a new random fingerprint
  DELETE /fingerprints/{email}  — delete a fingerprint profile

  GET    /settings              — list all settings aliases
  GET    /settings/{alias}      — get profile settings
  PUT    /settings/{alias}      — save profile settings
  DELETE /settings/{alias}      — delete profile settings

  POST   /{alias}/rename/{new}  — rename a profile alias
  POST   /{alias}/export         — export a profile bundle
  POST   /import                 — import a profile bundle
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.database import get_db
from stitch_backend.domains.profiles.fingerprint_service import FingerprintService
from stitch_backend.domains.profiles.schemas import (
    BrowserFingerprintProfile,
    ProfileSettingsRecord,
    ProfileSettingsV1,
)
from stitch_backend.domains.profiles.settings_service import ProfileSettingsService

logger = logging.getLogger(__name__)

profiles_router = APIRouter(prefix="/v1/profiles", tags=["Profiles"])


# ── Fingerprint endpoints ────────────────────────────────────────────────────

@profiles_router.get("/fingerprints")
async def list_fingerprints() -> list[str]:
    return FingerprintService.list_aliases()


@profiles_router.post("/fingerprints/generate")
async def generate_fingerprint() -> dict[str, Any]:
    profile = FingerprintService.generate()
    return profile.model_dump(mode="json", by_alias=True)


@profiles_router.get("/fingerprints/{email:path}")
async def load_fingerprint(email: str) -> dict[str, Any] | None:
    result = FingerprintService.load(email)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Profile not found: {email}")
    return result.model_dump(mode="json", by_alias=True)


@profiles_router.delete("/fingerprints/{email:path}")
async def delete_fingerprint(email: str) -> dict[str, bool]:
    FingerprintService.delete(email)
    return {"success": True}


# ── Settings endpoints ───────────────────────────────────────────────────────

@profiles_router.get("/settings")
async def list_settings(
    db: AsyncSession = Depends(get_db),
) -> list[str]:
    svc = ProfileSettingsService(db)
    return await svc.list_setting_aliases()


@profiles_router.get("/settings/{alias}")
async def get_settings(
    alias: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any] | None:
    svc = ProfileSettingsService(db)
    record = await svc.get_settings(alias)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Settings not found: {alias}")
    return record.model_dump(mode="json", by_alias=True)


class SaveSettingsBody(BaseModel):
    settings: ProfileSettingsV1


@profiles_router.put("/settings/{alias}")
async def save_settings(
    alias: str,
    body: SaveSettingsBody,
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    svc = ProfileSettingsService(db)
    await svc.save_settings(alias, body.settings)
    return {"success": True}


@profiles_router.delete("/settings/{alias}")
async def delete_settings(
    alias: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    svc = ProfileSettingsService(db)
    await svc.delete_settings(alias)
    return {"success": True}


# ── Alias & Bundle endpoints ─────────────────────────────────────────────────

@profiles_router.post("/{old_alias}/rename/{new_alias}")
async def rename_alias(
    old_alias: str,
    new_alias: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    svc = ProfileSettingsService(db)
    await svc.rename_alias(old_alias, new_alias)
    return {"success": True}


class ExportBody(BaseModel):
    destination_path: str


@profiles_router.post("/{alias}/export")
async def export_bundle(
    alias: str,
    body: ExportBody,
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    svc = ProfileSettingsService(db)
    await svc.export_bundle(alias, body.destination_path)
    return {"success": True}


class ImportBody(BaseModel):
    source_path: str
    target_alias: str | None = None
    overwrite: bool = False


@profiles_router.post("/import")
async def import_bundle(
    body: ImportBody,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    svc = ProfileSettingsService(db)
    alias = await svc.import_bundle(
        body.source_path, body.target_alias, body.overwrite,
    )
    return {"alias": alias}
