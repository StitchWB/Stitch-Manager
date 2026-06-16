"""Application settings loaded from .env / environment variables."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


# ── Project root detection ────────────────────────────────────────────────────
# python/stitch_backend/config.py  →  parent.parent = repo root
_BACKEND_DIR = Path(__file__).resolve().parent          # python/stitch_backend
PYTHON_DIR = _BACKEND_DIR.parent                        # python/
REPO_ROOT = PYTHON_DIR.parent                           # repo root


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
    database_url: str = f"sqlite+aiosqlite:///{REPO_ROOT / 'stitch.db'}"
    db_echo: bool = False            # SQLAlchemy statement logging

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
    return REPO_ROOT / "stitch.db"
