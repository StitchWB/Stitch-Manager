"""Profile command handlers — registered via ``@register_command``.

Thin adapters that parse request dicts → Pydantic DTOs and delegate to
``FingerprintService`` (file-based) or ``ProfileSettingsService`` (DB-backed).

Commands registered here:
  - generate_profile_rust
  - get_or_create_profile_rust
  - load_profile_rust
  - save_profile_rust
  - delete_profile_rust
  - list_profiles_rust
  - rename_profile_alias_rust
  - export_profile_bundle_rust
  - import_profile_bundle_rust
  - get_profile_settings_rust
  - save_profile_settings_rust
"""

from __future__ import annotations

import logging
from typing import Any

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session
from stitch_backend.domains.profiles.fingerprint_service import FingerprintService
from stitch_backend.domains.profiles.schemas import (
    DeleteProfileRequest,
    ExportBundleRequest,
    GetOrCreateProfileRequest,
    GetProfileSettingsRequest,
    ImportBundleRequest,
    LoadProfileRequest,
    RenameProfileRequest,
    SaveProfileRequest,
    SaveProfileSettingsRequest,
)
from stitch_backend.domains.profiles.settings_service import ProfileSettingsService

logger = logging.getLogger(__name__)


def _parse(model_cls, params: dict):
    """Instantiate a Pydantic model, tolerating camelCase *and* snake_case."""
    return model_cls.model_validate(params)


# ═════════════════════════════════════════════════════════════════════════════
# Fingerprint Profile Commands (file-based)
# ═════════════════════════════════════════════════════════════════════════════


@register_command("generate_profile_rust")
async def cmd_generate_profile(params: dict) -> Any:
    return FingerprintService.generate()


@register_command("get_or_create_profile_rust")
async def cmd_get_or_create_profile(params: dict) -> Any:
    req = _parse(GetOrCreateProfileRequest, params)
    return FingerprintService.get_or_create(req.email)


@register_command("load_profile_rust")
async def cmd_load_profile(params: dict) -> Any:
    req = _parse(LoadProfileRequest, params)
    result = FingerprintService.load(req.email)
    if result is None:
        return None
    return result


@register_command("save_profile_rust")
async def cmd_save_profile(params: dict) -> dict:
    req = _parse(SaveProfileRequest, params)
    FingerprintService.save(req.email, req.profile)
    return {"success": True}


@register_command("delete_profile_rust")
async def cmd_delete_profile(params: dict) -> dict:
    req = _parse(DeleteProfileRequest, params)
    FingerprintService.delete(req.email)
    # Also delete settings if they exist
    async def _op(session):
        svc = ProfileSettingsService(session)
        await svc.delete_settings(req.email)
    await run_in_session(_op)
    return {"success": True}


@register_command("list_profiles_rust")
async def cmd_list_profiles(params: dict) -> list[str]:
    return FingerprintService.list_aliases()


# ═════════════════════════════════════════════════════════════════════════════
# Profile Settings Commands (DB-backed)
# ═════════════════════════════════════════════════════════════════════════════


@register_command("get_profile_settings_rust")
async def cmd_get_profile_settings(params: dict) -> Any:
    req = _parse(GetProfileSettingsRequest, params)

    async def _op(session):
        svc = ProfileSettingsService(session)
        return await svc.get_settings(req.alias)

    return await run_in_session(_op)


@register_command("save_profile_settings_rust")
async def cmd_save_profile_settings(params: dict) -> dict:
    req = _parse(SaveProfileSettingsRequest, params)

    async def _op(session):
        svc = ProfileSettingsService(session)
        await svc.save_settings(req.alias, req.settings)

    await run_in_session(_op)
    return {"success": True}


# ═════════════════════════════════════════════════════════════════════════════
# Alias & Bundle Commands
# ═════════════════════════════════════════════════════════════════════════════


@register_command("rename_profile_alias_rust")
async def cmd_rename_profile_alias(params: dict) -> dict:
    req = _parse(RenameProfileRequest, params)

    async def _op(session):
        svc = ProfileSettingsService(session)
        await svc.rename_alias(req.current_alias, req.next_alias)

    await run_in_session(_op)
    return {"success": True}


@register_command("export_profile_bundle_rust")
async def cmd_export_profile_bundle(params: dict) -> dict:
    req = _parse(ExportBundleRequest, params)

    async def _op(session):
        svc = ProfileSettingsService(session)
        await svc.export_bundle(req.alias, req.destination_path)

    await run_in_session(_op)
    return {"success": True}


@register_command("import_profile_bundle_rust")
async def cmd_import_profile_bundle(params: dict) -> dict:
    req = _parse(ImportBundleRequest, params)

    async def _op(session):
        svc = ProfileSettingsService(session)
        alias = await svc.import_bundle(
            req.source_path, req.target_alias, req.overwrite,
        )
        return alias

    alias = await run_in_session(_op)
    return {"alias": alias}
