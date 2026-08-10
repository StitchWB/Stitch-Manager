"""Pydantic schemas for Profiles domain — request/response DTOs.

Field names use **camelCase** aliases to match the Rust-generated TypeScript
types (``BrowserFingerprintProfile``, ``ProfileSettingsV1``, etc.) so the
frontend can consume responses without transformation.

Two conceptually distinct structures live here:
  1. **Fingerprint profiles** — browser spoofing data (UA, screen, WebGL, …)
  2. **Profile settings** — versioned launcher configuration (network, geo,
     hardware, storage) stored in SQLite.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

# ── Fingerprint Profile ───────────────────────────────────────────────────────

class BrowserFingerprintProfile(BaseModel):
    """Browser fingerprint for spoofing — matches TS ``BrowserFingerprintProfile``."""

    model_config = ConfigDict(populate_by_name=True)

    user_agent: str = Field(alias="userAgent")
    platform: str
    vendor: str
    screen_width: int = Field(alias="screenWidth")
    screen_height: int = Field(alias="screenHeight")
    avail_width: int = Field(alias="availWidth")
    avail_height: int = Field(alias="availHeight")
    color_depth: int = Field(alias="colorDepth")
    pixel_ratio: float = Field(alias="pixelRatio")
    hardware_concurrency: int = Field(alias="hardwareConcurrency")
    device_memory: int = Field(alias="deviceMemory")
    max_touch_points: int = Field(alias="maxTouchPoints")
    webgl_vendor: str = Field(alias="webglVendor")
    webgl_renderer: str = Field(alias="webglRenderer")
    timezone: str
    timezone_offset: int = Field(alias="timezoneOffset")
    locale: str
    latitude: float
    longitude: float
    accuracy: float
    noise_seed: int = Field(alias="noiseSeed")
    fonts: list[str]


# ── Profile Settings (versioned launcher config) ──────────────────────────────

class ProfileSettingsProxy(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    enabled: bool = False
    proxy_library_id: str | None = Field(None, alias="proxyLibraryId")


class ProfileSettingsNetwork(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    proxy: ProfileSettingsProxy | None = None


class ProfileSettingsGeo(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    timezone: str | None = None
    locale: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class ProfileSettingsBrowserWindow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    mode: str | None = None
    width: int | None = None
    height: int | None = None
    maximize_on_start: bool | None = Field(None, alias="maximizeOnStart")


class ProfileSettingsHardware(BaseModel):
    """Hardware-adjacent launcher settings.

    Identity fields (userAgent/platform/hardwareConcurrency/deviceMemory/
    screenWidth/screenHeight) were removed: the browser engine owns identity
    and nothing consumed them. Pydantic ignores the legacy keys still present
    in previously stored configs.
    """

    model_config = ConfigDict(populate_by_name=True)

    browser_window: ProfileSettingsBrowserWindow | None = Field(
        None, alias="browserWindow"
    )


class ProfileSettingsStorage(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    cookies: str | None = None
    notes: str | None = None
    last_url: str | None = Field(None, alias="lastUrl")
    last_scenario_path: str | None = Field(None, alias="lastScenarioPath")


class ProfileSettingsV1(BaseModel):
    """Versioned profile settings — matches TS ``ProfileSettingsV1``."""

    model_config = ConfigDict(populate_by_name=True)

    version: int = 1
    network: ProfileSettingsNetwork = Field(default_factory=ProfileSettingsNetwork)
    geo: ProfileSettingsGeo = Field(default_factory=ProfileSettingsGeo)
    hardware: ProfileSettingsHardware = Field(default_factory=ProfileSettingsHardware)
    storage: ProfileSettingsStorage = Field(default_factory=ProfileSettingsStorage)
    engine: str | None = None


class ProfileSettingsRecord(BaseModel):
    """Full record returned by the backend — matches TS ``ProfileSettingsRecord``."""

    model_config = ConfigDict(populate_by_name=True)

    alias: str
    settings: ProfileSettingsV1
    cookies: str | None = None
    notes: str | None = None
    updated_at: str | None = Field(None, alias="updatedAt")


# ── Request DTOs ──────────────────────────────────────────────────────────────

class GenerateProfileRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class GetOrCreateProfileRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    email: str | None = None


class LoadProfileRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    email: str


class SaveProfileRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    email: str
    profile: BrowserFingerprintProfile


class DeleteProfileRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    email: str


class RenameProfileRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    current_alias: str = Field(alias="current_alias")
    next_alias: str = Field(alias="next_alias")


class ExportBundleRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    alias: str
    destination_path: str = Field(alias="destination_path")


class ImportBundleRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    source_path: str = Field(alias="source_path")
    target_alias: str | None = Field(None, alias="target_alias")
    overwrite: bool = False


class GetProfileSettingsRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    alias: str


class SaveProfileSettingsRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    alias: str
    settings: ProfileSettingsV1
