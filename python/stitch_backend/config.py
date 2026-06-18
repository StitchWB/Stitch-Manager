"""Application settings loaded from .env / environment variables."""

from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# ── Project root detection ────────────────────────────────────────────────────
# python/stitch_backend/config.py  →  parent.parent = repo root
_BACKEND_DIR = Path(__file__).resolve().parent          # python/stitch_backend
PYTHON_DIR = _BACKEND_DIR.parent                        # python/
REPO_ROOT = PYTHON_DIR.parent                           # repo root


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
    (e.g. fresh dev checkout without an installed Tauri app).
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

    # ── CORS ──────────────────────────────────────────────────────────────────
    cors_origins: str = "*"          # comma-separated or "*"

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = ""  # computed dynamically if empty
    db_echo: bool = False            # SQLAlchemy statement logging

    @model_validator(mode="after")
    def _compute_db_url(self) -> "Settings":
        """Fill in database_url with the canonical path when not set via env."""
        if not self.database_url:
            self.database_url = _default_db_url()
        return self

    # ── OmniRoute sidecar ────────────────────────────────────────────────────
    omniroute_host: str = "127.0.0.1"
    omniroute_port: int = 20128
    omniroute_auto_start: bool = False

    # ── Email / IMAP ──────────────────────────────────────────────────────────
    imap_host: Optional[str] = None
    imap_port: int = 993
    imap_user: Optional[str] = None
    imap_password: Optional[str] = None
    imap_folder: str = "INBOX"

    # ── Captcha solving ───────────────────────────────────────────────────────
    captcha_provider: str = "turnstile"   # turnstile | hcaptcha
    captcha_api_key: Optional[str] = None

    # ── Registration ──────────────────────────────────────────────────────────
    reg_max_concurrency: int = 3
    reg_default_retries: int = 3

    # ── Paths ─────────────────────────────────────────────────────────────────
    profiles_dir: str = str(REPO_ROOT / "profiles")
    cloakbrowser_dir: str = str(REPO_ROOT / "resources" / "cloakbrowser")

    # ── Helpers ───────────────────────────────────────────────────────────────
    @property
    def omniroute_base_url(self) -> str:
        return f"http://{self.omniroute_host}:{self.omniroute_port}"

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
