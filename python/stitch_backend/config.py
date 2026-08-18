"""Application settings loaded from .env / environment variables."""

from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# ── Project root detection ────────────────────────────────────────────────────
# In dev mode: python/stitch_backend/config.py  →  parent.parent = repo root
# In PyInstaller .exe: use sys._MEIPASS (bundled resources directory)

if getattr(sys, 'frozen', False):
    # Running as PyInstaller bundle
    REPO_ROOT = Path(cast('Any', sys)._MEIPASS)
else:
    # Running from source
    _BACKEND_DIR = Path(__file__).resolve().parent          # python/stitch_backend
    PYTHON_DIR = _BACKEND_DIR.parent                        # python/
    REPO_ROOT = PYTHON_DIR.parent                           # repo root

# Some launchers (elevated desktop app, services) start the backend without
# LOCALAPPDATA in the environment.  Third-party caches that derive their
# directory from it (shardx SDK → %LOCALAPPDATA%\shardx-sdk) would otherwise
# silently use a different location per process: the status probe says
# "not installed" while another process already downloaded the engine, and
# launches re-download 170 MB into a second directory.  Normalize once, here,
# so the backend AND every worker it spawns agree on the canonical cache.
if sys.platform == "win32":
    os.environ.setdefault("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))


def _app_data_dir() -> Path:
    """Return the OS-specific local app-data directory (mirrors Rust ``dirs::data_local_dir``).

    - Windows: ``%LOCALAPPDATA%``  (``C:\\Users\\<user>\\AppData\\Local``)
    - macOS:   ``~/Library/Application Support``
    - Linux:   ``~/.local/share``
    """
    if sys.platform == "win32":
        import os
        local = os.environ.get("LOCALAPPDATA")
        if local:
            return Path(local)
        return Path.home() / "AppData" / "Local"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support"
    # Linux / other
    return Path.home() / ".local" / "share"


def _default_db_url() -> str:
    """Build the default SQLite URL pointing at the same DB the Rust backend uses.

    Path: ``{data_local_dir}/stitch-manager/stitch.db``
    Falls back to ``REPO_ROOT/stitch.db`` when the canonical dir doesn't exist
    (e.g. fresh dev checkout without an installed backend app).
    """
    canonical = _app_data_dir() / "stitch-manager"
    if canonical.is_dir():
        db_path = canonical / "stitch.db"
    else:
        # Dev fallback — use repo root so tests / first-run still work
        db_path = REPO_ROOT / "stitch.db"
        canonical.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{db_path}"


class Settings(BaseSettings):
    """All tunables for the Stitch backend.  Values come from .env first,
    then OS env vars, then the defaults declared here."""

    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Server ────────────────────────────────────────────────────────────────
    host: str = "127.0.0.1"
    port: int = 25584
    debug: bool = False
    log_level: str = "INFO"

    # ── LiteLLM gateway ────────────────────────────────────────────────────────
    litellm_gateway_enabled: bool = True
    litellm_gateway_local_api_key: str | None = None
    litellm_gateway_model_prefix: str = "/v1"

    # ── CORS ──────────────────────────────────────────────────────────────────
    # Restricted to known dev origins. "*" with allow_credentials=True lets any
    # webpage call this local API (no auth layer yet). Set STITCH_CORS_ORIGINS
    # (comma-separated) in .env to widen for production / other dev ports.
    cors_origins: str = Field(
        default="http://localhost:5173,http://localhost:5174,http://localhost:3000",
        validation_alias=AliasChoices("cors_origins", "STITCH_CORS_ORIGINS"),
    )

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = ""  # computed dynamically if empty
    db_echo: bool = False            # SQLAlchemy statement logging

    @model_validator(mode="after")
    def _compute_db_url(self) -> Settings:
        """Fill in database_url with the canonical path when not set via env."""
        if not self.database_url:
            self.database_url = _default_db_url()
        return self

    # ── Native AI gateway ───────────────────────────────────────────────────
    proxy_port: int = 20128

    # ── AiApiRadar proxy ─────────────────────────────────────────────────────
    # Base URL for the AiApiRadar community API (offers + stats).  Overridable
    # via the AIRADAR_API_URL env var.
    airadadar_api_url: str = "https://api.aiapiradar.cf.whitebite.ru"
    # Admin token for AiApiRadar's admin-gated endpoints (found keys).
    airadar_admin_token: str = ""
    # Base URL for the found-keys endpoints; the secret endpoint lives on the
    # VDS instance only (vds-only on the radar side). Falls back to
    # airadadar_api_url when empty.
    airadar_keys_url: str = ""
    # Shared secret with AiApiRadar (same value as AIRADAR_STITCH_SECRET there):
    # mint short-lived HS256 role assertions so Stitch-authenticated VIP+ users
    # read found keys without a second login. Empty → AIRADAR_ADMIN_TOKEN.
    radar_shared_secret: str = ""
    # Minimum role allowed to read found keys
    # (ladder: user < vip < premium < elite < admin).
    radar_min_role: str = "vip"

    # ── Email / IMAP ──────────────────────────────────────────────────────────
    imap_host: str | None = None
    imap_port: int = 993
    imap_user: str | None = None
    imap_password: str | None = None
    imap_folder: str = "INBOX"

    # ── Captcha solving ───────────────────────────────────────────────────────
    captcha_provider: str = "turnstile"   # turnstile | hcaptcha
    captcha_api_key: str | None = None

    # ── Registration ──────────────────────────────────────────────────────────
    reg_max_concurrency: int = 3
    reg_default_retries: int = 3

    # ── App-level auth (VDS / multi-user mode) ────────────────────────────────
    # On by default — the auth subsystem (login/setup/me/users) is always
    # wired up.  Disable via ``STITCH_AUTH_ENABLED=0`` for headless / dev
    # runs (the middleware becomes a no-op and the auth endpoints return
    # synthetic responses).  The env var name uses the ``STITCH_`` prefix
    # (accepted via ``AliasChoices``); the bare ``AUTH_ENABLED`` name is
    # also accepted for backwards compatibility.
    auth_enabled: bool = Field(
        True,
        validation_alias=AliasChoices("auth_enabled", "STITCH_AUTH_ENABLED"),
    )
    # Force login to be mandatory from first run (VDS / multi-user
    # deployments).  When ``False`` (desktop default), the app is usable
    # without login until the first user is created via ``/api/auth/setup``
    # — after which ``has_users > 0`` makes login mandatory.  Effective
    # ``required = auth_required OR (has_users > 0)``.  VDS sets
    # ``STITCH_AUTH_REQUIRED=1`` to enforce auth from the first run.
    auth_required: bool = Field(
        False,
        validation_alias=AliasChoices("auth_required", "STITCH_AUTH_REQUIRED"),
    )
    # Bootstrap only — used by the lifespan / ``create-admin`` CLI to seed the
    # first admin account.  Never logged.  Reads ``STITCH_ADMIN_PASSWORD``.
    admin_password: str | None = Field(
        None,
        validation_alias=AliasChoices("admin_password", "STITCH_ADMIN_PASSWORD"),
    )

    # ── Telegram OIDC login ────────────────────────────────────────────────────
    # ``legacy`` (default) keeps the existing HMAC widget verification; ``oidc``
    # switches to verifying Telegram-issued OIDC ``id_token``s (RS256 via JWKS).
    # The BotOwner flips this irreversibly after both products ship OIDC support.
    # Invalid values fail fast at startup (model_validator below).
    tg_auth_mode: str = Field(
        "legacy",
        validation_alias=AliasChoices("tg_auth_mode", "TG_AUTH_MODE"),
    )
    # The Telegram bot's numeric id — used as the JWT ``aud`` claim.  Defaults to
    # @whitebite_stitch_bot's id.  Override via ``TG_BOT_CLIENT_ID`` when testing
    # against a different bot.
    tg_bot_client_id: str = Field(
        "8606505679",
        validation_alias=AliasChoices("tg_bot_client_id", "TG_BOT_CLIENT_ID"),
    )

    @model_validator(mode="after")
    def _validate_tg_auth_mode(self) -> Settings:
        """Fail fast when ``TG_AUTH_MODE`` is not ``legacy`` or ``oidc``."""
        if self.tg_auth_mode not in ("legacy", "oidc"):
            raise ValueError(
                f"TG_AUTH_MODE must be 'legacy' or 'oidc', got {self.tg_auth_mode!r}"
            )
        return self

    # ── Paths ─────────────────────────────────────────────────────────────────
    profiles_dir: str = str(REPO_ROOT / "profiles")
    cloakbrowser_dir: str = str(REPO_ROOT / "resources" / "cloakbrowser")

    # ── Helpers ───────────────────────────────────────────────────────────────
    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached singleton — safe to call from anywhere."""
    return Settings()


def get_database_path() -> Path:
    """Extract the SQLite database file path from database_url."""
    url = get_settings().database_url
    # sqlite+aiosqlite:///path/to/stitch.db → /path/to/stitch.db
    if ":///" in url:
        return Path(url.split(":///", 1)[1])
    return _app_data_dir() / "stitch-manager" / "stitch.db"
