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

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

import logging
from typing import Any, cast

from stitch_backend.core.command_decorator import command
from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_read_session, run_in_session
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


def _caller_uid(params: dict) -> int | None:
    """Extract the caller's user ID (None when auth disabled / desktop)."""
    return params.get("_caller_user_id")


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


@command("delete_profile_rust")
async def cmd_delete_profile(db: AsyncSession, params: dict) -> dict:
    req = _parse(DeleteProfileRequest, params)
    owner_id = _caller_uid(params)
    FingerprintService.delete(req.email)
    # Also delete settings if they exist (owner-filtered)

    svc = ProfileSettingsService(db)
    await svc.delete_settings(req.email, owner_id=owner_id)

    return {"success": True}


@register_command("list_profiles_rust", readonly=True)
async def cmd_list_profiles(params: dict) -> list[str]:
    """List known profile aliases.

    The registry of record is the ``profile_settings`` table; fingerprint
    JSON files remain a legacy source so existing installs keep their
    profiles visible.
    """
    owner_id = _caller_uid(params)

    async def _op(session):
        svc = ProfileSettingsService(session)
        return await svc.list_setting_aliases(owner_id=owner_id)

    db_aliases = await run_in_read_session(_op)
    seen = {a.lower() for a in db_aliases}
    return list(db_aliases) + [
        a for a in FingerprintService.list_aliases() if a.lower() not in seen
    ]


# ═════════════════════════════════════════════════════════════════════════════
# Profile Settings Commands (DB-backed)
# ═════════════════════════════════════════════════════════════════════════════


@command("get_profile_settings_rust")
async def cmd_get_profile_settings(db: AsyncSession, params: dict) -> Any:
    req = _parse(GetProfileSettingsRequest, params)
    owner_id = _caller_uid(params)

    svc = ProfileSettingsService(db)
    return await svc.get_settings(req.alias, owner_id=owner_id)


@command("save_profile_settings_rust")
async def cmd_save_profile_settings(db: AsyncSession, params: dict) -> dict:
    req = _parse(SaveProfileSettingsRequest, params)
    owner_id = _caller_uid(params)

    svc = ProfileSettingsService(db)
    await svc.save_settings(req.alias, req.settings, owner_id=owner_id)

    return {"success": True}


# ═════════════════════════════════════════════════════════════════════════════
# Alias & Bundle Commands
# ═════════════════════════════════════════════════════════════════════════════


@command("rename_profile_alias_rust")
async def cmd_rename_profile_alias(db: AsyncSession, params: dict) -> dict:
    req = _parse(RenameProfileRequest, params)
    owner_id = _caller_uid(params)

    svc = ProfileSettingsService(db)
    await svc.rename_alias(
        req.current_alias, req.next_alias, owner_id=owner_id,
    )

    return {"success": True}


@command("export_profile_bundle_rust")
async def cmd_export_profile_bundle(db: AsyncSession, params: dict) -> dict:
    req = _parse(ExportBundleRequest, params)

    svc = ProfileSettingsService(db)
    await svc.export_bundle(req.alias, req.destination_path)

    return {"success": True}


@register_command("import_profile_bundle_rust")
async def cmd_import_profile_bundle(params: dict) -> str:
    """Import profile bundle and return alias as str."""
    req = _parse(ImportBundleRequest, params)
    owner_id = _caller_uid(params)

    async def _op(session):
        svc = ProfileSettingsService(session)
        alias = await svc.import_bundle(
            req.source_path, req.target_alias, req.overwrite,
            owner_id=owner_id,
        )
        return cast("str", alias)

    alias = await run_in_session(_op)
    return cast("str", alias)
