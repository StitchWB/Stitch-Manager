"""Profile settings service — DB-backed versioned browser profile configuration.

Ports the settings-related commands from legacy Rust profile modules.

Responsibilities:
  - CRUD for ``profile_settings`` table (via BaseRepository)
  - Proxy-save-use policy enforcement
  - Alias rename with cascade to scenarios/composed_flows tables
  - Bundle export/import (fingerprint + settings + scenarios + flows)
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import or_, select, text

from stitch_backend.core.base_repository import BaseRepository
from stitch_backend.core.base_service import BaseService
from stitch_backend.core.exceptions import (
    ProfileAliasExistsError,
    ProfileError,
    ProfileNotFoundError,
)
from stitch_backend.domains.profiles.fingerprint_service import FingerprintService
from stitch_backend.domains.profiles.models import ProfileSettings
from stitch_backend.domains.profiles.schemas import (
    ProfileSettingsRecord,
    ProfileSettingsV1,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ── Repository ────────────────────────────────────────────────────────────────

class ProfileSettingsRepo(BaseRepository[ProfileSettings]):
    _model = ProfileSettings
    _pk = "alias"

    async def upsert(
        self, alias: str, config_json: str,
        cookies: str | None = None, notes: str | None = None,
        owner_id: int | None = None,
    ) -> ProfileSettings:
        existing = await self.get_by_pk(alias)
        if existing:
            # Preserve existing owner_id on update — do not let a different
            # caller hijack a shared/legacy row by re-upserting under their id.
            existing.config_json = config_json
            existing.cookies = cookies
            existing.notes = notes
            existing.updated_at = datetime.now(UTC)
            await self._db.flush()
            await self._db.refresh(existing)
            return existing
        return await self.create(
            alias=alias, config_json=config_json,
            cookies=cookies, notes=notes,
            owner_id=owner_id,
            updated_at=datetime.now(UTC),
        )

    async def get_by_pk_for_owner(
        self, alias: str, owner_id: int | None = None,
    ) -> ProfileSettings | None:
        result = await self._db.execute(
            select(ProfileSettings).where(
                ProfileSettings.alias == alias,
                or_(
                    ProfileSettings.owner_id.is_(None),
                    ProfileSettings.owner_id == owner_id,
                ),
            )
        )
        return result.scalar_one_or_none()

    async def delete_by_pk_for_owner(
        self, alias: str, owner_id: int | None = None,
    ) -> bool:
        row = await self.get_by_pk_for_owner(alias, owner_id)
        if row is None:
            return False
        await self._db.delete(row)
        await self._db.flush()
        return True

    async def list_all_for_owner(
        self, owner_id: int | None = None,
        order_by: Any | None = None,
    ) -> list[ProfileSettings]:
        stmt = select(ProfileSettings).where(
            or_(
                ProfileSettings.owner_id.is_(None),
                ProfileSettings.owner_id == owner_id,
            )
        )
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        result = await self._db.execute(stmt)
        return list(result.scalars().all())

    async def rename_alias(self, old_alias: str, new_alias: str) -> None:
        stmt = text(
            "UPDATE profile_settings SET alias = :new, updated_at = datetime('now') "
            "WHERE alias = :old"
        )
        await self._db.execute(stmt, {"new": new_alias, "old": old_alias})
        await self._db.flush()


# ── Service ───────────────────────────────────────────────────────────────────

class ProfileSettingsService(BaseService):
    """Business logic for profile settings."""

    def __init__(self, db: AsyncSession) -> None:
        super().__init__(db)
        self._repo = ProfileSettingsRepo(db)

    async def get_settings(
        self, alias: str, owner_id: int | None = None,
    ) -> ProfileSettingsRecord | None:
        """Load settings by alias; returns None if not found.

        Transparently migrates legacy inline-proxy configs to the
        proxyLibraryId format on first read (same as Rust).
        """
        alias = alias.strip()
        if not alias:
            raise ProfileError("alias is required")
        row = await self._repo.get_by_pk_for_owner(alias, owner_id)
        if row is None:
            return None
        # Transparent legacy proxy migration
        migrated = await self._migrate_legacy_proxy_if_needed(row)
        if migrated:
            row = await self._repo.get_by_pk_for_owner(alias, owner_id)
        return self._row_to_record(cast("ProfileSettings", row))

    async def save_settings(
        self, alias: str, settings: ProfileSettingsV1,
        owner_id: int | None = None,
    ) -> None:
        """Save settings; validates version and enforces proxy policy."""
        alias = alias.strip()
        if not alias:
            raise ProfileError("alias is required")
        if settings.version != 1:
            raise ProfileError(f"Unsupported settings version: {settings.version}")

        # Enforce proxy save-use policy (mirrors Rust enforce_proxy_save_use_policy)
        self._enforce_proxy_save_use_policy(settings)

        config_json = settings.model_dump_json(by_alias=True)
        cookies = settings.storage.cookies
        notes = settings.storage.notes
        await self._repo.upsert(
            alias, config_json, cookies, notes, owner_id=owner_id,
        )
        logger.info("[Profiles] Settings saved for alias=%s", alias)

    async def delete_settings(
        self, alias: str, owner_id: int | None = None,
    ) -> bool:
        return await self._repo.delete_by_pk_for_owner(alias, owner_id)

    async def list_setting_aliases(
        self, owner_id: int | None = None,
    ) -> list[str]:
        rows = await self._repo.list_all_for_owner(
            owner_id=owner_id,
            order_by=ProfileSettings.updated_at.desc(),
        )
        return [r.alias for r in rows]

    async def rename_alias(
        self, old_alias: str, new_alias: str,
    ) -> None:
        """Rename a profile alias with cascade to related tables."""
        old_alias = old_alias.strip()
        new_alias = new_alias.strip()
        if not old_alias or not new_alias:
            raise ProfileError("Both current_alias and next_alias are required")
        if old_alias.lower() == new_alias.lower():
            return

        # Check new alias doesn't collide with an existing profile
        # (fingerprint files or settings rows)
        existing = {a.lower() for a in FingerprintService.list_aliases()}
        existing |= {a.lower() for a in await self.list_setting_aliases()}
        if new_alias.lower() in existing:
            raise ProfileAliasExistsError(new_alias)

        # Rename fingerprint file
        old_profile = FingerprintService.load(old_alias)
        if old_profile:
            FingerprintService.save(new_alias, old_profile)
            FingerprintService.delete(old_alias)

        # Rename in profile_settings
        await self._repo.rename_alias(old_alias, new_alias)

        # Cascade to tables WITH updated_at column (best-effort)
        for table in ("scenarios", "composed_flows"):
            try:
                await self._db.execute(
                    text(
                        f"UPDATE {table} SET alias = :new, "
                        f"updated_at = datetime('now') WHERE alias = :old"
                    ),
                    {"new": new_alias, "old": old_alias},
                )
            except Exception as exc:
                logger.warning(
                    "[Profiles] Cascade rename %s→%s in %s skipped: %s",
                    old_alias, new_alias, table, exc,
                )
        # scenario_runs has NO updated_at column
        try:
            await self._db.execute(
                text("UPDATE scenario_runs SET alias = :new WHERE alias = :old"),
                {"new": new_alias, "old": old_alias},
            )
        except Exception as exc:
            logger.warning(
                "[Profiles] Cascade rename %s→%s in scenario_runs skipped: %s",
                old_alias, new_alias, exc,
            )
        await self._db.flush()
        logger.info("[Profiles] Alias renamed: %s → %s", old_alias, new_alias)

    async def export_bundle(
        self, alias: str, destination_path: str,
    ) -> None:
        """Export profile + settings + scenarios + flows to a JSON file."""
        alias = alias.strip()
        if not alias:
            raise ProfileError("alias is required")
        if not destination_path.strip():
            raise ProfileError("destination_path is required")

        profile = FingerprintService.load(alias)
        settings_record = await self.get_settings(alias)
        if profile is None and settings_record is None:
            raise ProfileNotFoundError(alias)
        scenarios = await self._fetch_related("scenarios", alias)
        flows = await self._fetch_related("composed_flows", alias)

        payload = {
            "version": 1,
            "alias": alias,
            "profile": (
                profile.model_dump(mode="json", by_alias=True) if profile else None
            ),
            "settings": (
                settings_record.model_dump(mode="json", by_alias=True)
                if settings_record else None
            ),
            "scenarios": scenarios,
            "composedFlows": flows,
            "exportedAt": datetime.now(UTC).isoformat(),
        }
        Path(destination_path).write_text(
            json.dumps(payload, indent=2), encoding="utf-8"
        )
        logger.info("[Profiles] Bundle exported: %s → %s", alias, destination_path)

    async def import_bundle(
        self, source_path: str, target_alias: str | None = None,
        overwrite: bool = False,
    ) -> str:
        """Import a profile bundle from a JSON file."""
        if not source_path.strip():
            raise ProfileError("source_path is required")
        raw = json.loads(Path(source_path).read_text(encoding="utf-8"))
        version = raw.get("version", 1)
        if version != 1:
            raise ProfileError(f"Unsupported bundle version: {version}")

        source_alias = (raw.get("alias") or "").strip()
        if not source_alias:
            raise ProfileError("bundle alias is required")
        alias = (target_alias or source_alias).strip()

        # Check conflict
        existing = {a.lower() for a in FingerprintService.list_aliases()}
        existing |= {a.lower() for a in await self.list_setting_aliases()}
        if alias.lower() in existing and not overwrite:
            raise ProfileAliasExistsError(alias)

        # Import fingerprint
        profile_data = raw.get("profile")
        if profile_data:
            from stitch_backend.domains.profiles.schemas import (
                BrowserFingerprintProfile,
            )
            profile = BrowserFingerprintProfile.model_validate(profile_data)
            FingerprintService.save(alias, profile)

        # Import settings
        settings_obj = raw.get("settings")
        if settings_obj and isinstance(settings_obj, dict) and "settings" in settings_obj:
            s = ProfileSettingsV1.model_validate(settings_obj["settings"])
            cookies = settings_obj.get("cookies") or s.storage.cookies
            notes = settings_obj.get("notes") or s.storage.notes
            config_json = s.model_dump_json(by_alias=True)
            await self._repo.upsert(alias, config_json, cookies, notes)

        # Import scenarios and flows (best-effort)
        await self._import_related("scenarios", alias, raw.get("scenarios", []))
        await self._import_related("composed_flows", alias, raw.get("composedFlows", []))

        logger.info("[Profiles] Bundle imported from %s as alias=%s", source_path, alias)
        return alias

    # ── Helpers ────────────────────────────────────────────────────────────

    @staticmethod
    def _row_to_record(row: ProfileSettings) -> ProfileSettingsRecord:
        settings = ProfileSettingsV1.model_validate_json(row.config_json)
        updated = row.updated_at.isoformat() if row.updated_at else None
        return ProfileSettingsRecord(
            alias=row.alias,
            settings=settings,
            cookies=row.cookies,
            notes=row.notes,
            updated_at=updated,
        )

    async def _fetch_related(self, table: str, alias: str) -> list[dict]:
        """Fetch all rows from a related table by alias."""
        try:
            result = await self._db.execute(
                text(f"SELECT * FROM {table} WHERE alias = :a"),
                {"a": alias},
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        except Exception:
            return []

    @staticmethod
    def _enforce_proxy_save_use_policy(settings: ProfileSettingsV1) -> None:
        """Validate proxy config before save (mirrors Rust enforce_proxy_save_use_policy).

        When proxy is enabled, a proxyLibraryId MUST be present.
        TODO: also check is_proxy_save_use_allowed(db, pid, max_age=300)
        """
        proxy = settings.network.proxy
        if not proxy or not proxy.enabled:
            return
        pid = (proxy.proxy_library_id or "").strip()
        if not pid:
            raise ProfileError(
                "proxy_save_use_guard_failed|proxyLibraryId is required "
                "when proxy is enabled"
            )

    async def _migrate_legacy_proxy_if_needed(
        self, row: ProfileSettings,
    ) -> bool:
        """Migrate legacy inline-proxy settings to proxyLibraryId format.

        Legacy format stores ``url``, ``username``, ``password`` directly
        inside ``network.proxy``.  The new format references a row in the
        proxy_library via ``proxyLibraryId``.

        Returns True if migration was performed and the row was re-saved.
        """
        try:
            raw = json.loads(row.config_json)
        except (json.JSONDecodeError, TypeError):
            return False

        proxy_obj = (
            raw.get("network", {}).get("proxy")
        )
        if not proxy_obj or not isinstance(proxy_obj, dict):
            return False
        if not proxy_obj.get("enabled"):
            return False
        if (proxy_obj.get("proxyLibraryId") or "").strip():
            return False  # already migrated

        raw_url = (proxy_obj.get("url") or "").strip()
        if not raw_url:
            return False

        # Try to parse the proxy URL and register it in proxy_library
        try:
            import stitch_backend.domains.proxy_library.service as _pls
            from stitch_backend.domains.proxy_library.service import (
                parse_proxy_line,
            )
            upsert_proxy_entry = cast("Any", _pls).upsert_proxy_entry
            draft = cast("dict[str, Any]", parse_proxy_line(raw_url))
            legacy_user = (proxy_obj.get("username") or "").strip()
            legacy_pass = (proxy_obj.get("password") or "").strip()
            if legacy_user:
                cast("dict[str, Any]", draft)["username"] = legacy_user
                cast("dict[str, Any]", draft)["password"] = legacy_pass
            cast("dict[str, Any]", draft)["enabled"] = True
            cast("dict[str, Any]", draft)["label"] = f"{row.alias} proxy"
            proxy_id = await upsert_proxy_entry(self._db, draft)

            proxy_obj["proxyLibraryId"] = proxy_id
            proxy_obj.pop("url", None)
            proxy_obj.pop("username", None)
            proxy_obj.pop("password", None)

            new_json = json.dumps(raw)
            await self._repo.upsert(
                row.alias, new_json, row.cookies, row.notes,
            )
            logger.info(
                "[Profiles] Legacy proxy migrated for alias=%s → %s",
                row.alias, proxy_id,
            )
            return True
        except Exception as exc:
            logger.warning(
                "[Profiles] Legacy proxy migration skipped for %s: %s",
                row.alias, exc,
            )
            return False

    async def _import_related(
        self, table: str, alias: str, items: list[dict],
    ) -> None:
        """Import items into a related table (best-effort)."""
        if not items:
            return
        for item in items:
            try:
                if table == "scenarios":
                    sp = (item.get("scenarioPath") or "").strip()
                    if not sp:
                        continue
                    await self._db.execute(
                        text(
                            "INSERT OR REPLACE INTO scenarios "
                            "(id, alias, name, scenario_path, run_id, started_url, "
                            "steps_count, created_at, metadata_json) "
                            "VALUES (:id, :alias, :name, :sp, :rid, :su, :sc, :ca, :mj)"
                        ),
                        {
                            "id": f"scenario_{uuid.uuid4()}",
                            "alias": alias,
                            "name": item.get("name", "Imported"),
                            "sp": sp,
                            "rid": item.get("runId"),
                            "su": item.get("startedUrl"),
                            "sc": item.get("stepsCount", 0),
                            "ca": item.get("createdAt"),
                            "mj": item.get("metadataJson"),
                        },
                    )
                elif table == "composed_flows":
                    fj = (item.get("flowJson") or "").strip()
                    if not fj:
                        continue
                    await self._db.execute(
                        text(
                            "INSERT OR REPLACE INTO composed_flows "
                            "(id, alias, name, flow_json) "
                            "VALUES (:id, :alias, :name, :fj)"
                        ),
                        {
                            "id": f"flow_{uuid.uuid4()}",
                            "alias": alias,
                            "name": item.get("name", "Imported"),
                            "fj": fj,
                        },
                    )
            except Exception as exc:
                logger.warning("[Profiles] Import skipped for %s: %s", table, exc)
