"""Server settings loaded from STITCH_SERVER_* env vars and .env file.

Mirrors ``stitch_backend/config.py`` conventions: pydantic-settings
BaseSettings, lru-cached singleton, .env at repo root.
"""

from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

from pydantic_settings import BaseSettings, SettingsConfigDict

# ── Project root detection ────────────────────────────────────────────────────

if getattr(sys, "frozen", False):
    REPO_ROOT = Path(cast("Any", sys)._MEIPASS)
else:
    _SERVER_DIR = Path(__file__).resolve().parent  # python/stitch_server
    PYTHON_DIR = _SERVER_DIR.parent                # python/
    REPO_ROOT = PYTHON_DIR.parent                  # repo root


def _app_data_dir() -> Path:
    """OS-specific local app-data directory (mirrors stitch_backend/config.py)."""
    if sys.platform == "win32":
        import os

        local = os.environ.get("LOCALAPPDATA")
        if local:
            return Path(local)
        return Path.home() / "AppData" / "Local"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support"
    return Path.home() / ".local" / "share"


def _default_data_dir() -> Path:
    """Default data directory for the plugin server."""
    canonical = _app_data_dir() / "stitch-manager" / "server"
    canonical.mkdir(parents=True, exist_ok=True)
    return canonical


def _default_db_url() -> str:
    """Build the default SQLite URL for the plugin server DB."""
    db_path = _default_data_dir() / "stitch_server.db"
    return f"sqlite+aiosqlite:///{db_path}"


class Settings(BaseSettings):
    """All tunables for the stitch plugin server.

    Values come from STITCH_SERVER_* env vars, then .env, then defaults.
    """

    model_config = SettingsConfigDict(
        env_prefix="STITCH_SERVER_",
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Server ────────────────────────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8900
    debug: bool = False
    log_level: str = "INFO"

    # ── Database ───────────────────────────────────────────────────────────────
    database_url: str = ""  # computed dynamically if empty
    db_echo: bool = False

    # ── Security ───────────────────────────────────────────────────────────────
    # ed25519 public key (hex) for verifying package/manifest signatures.
    # Served to clients in the /activate response. The private key is OFFLINE.
    pubkey: str = ""

    # Admin secret — required for all /admin/* endpoints.
    admin_key: str = ""

    # ── Policy ────────────────────────────────────────────────────────────────
    device_limit: int = 3
    # When True, clients accept a null manifest signature (local dev only).
    # In release builds this must be False.
    dev_mode: bool = False

    # ── Activation-code lifecycle ──────────────────────────────────────────────
    # Default TTL for newly issued codes (minutes).  Overridable per-issue via
    # the ``ttl_minutes`` field on POST /admin/issue-code.  ``ttl_minutes=0``
    # means no expiration (``expires_at`` NULL); ``ttl_minutes=None`` falls
    # back to this configured default.
    code_ttl_minutes: int = 60

    # ── Rate limiting on POST /activate ─────────────────────────────────────────
    # Per-IP sliding-window limit.  Default 10 attempts per 60s — a single
    # uvicorn worker behind nginx, so an in-memory dict is sufficient.
    activate_rate_limit: int = 10
    activate_rate_window_seconds: int = 60

    # ── Storage ───────────────────────────────────────────────────────────────
    plugins_dir: str = ""
    reports_dir: str = ""

    # ── Alerting (plan §6 Phase 4) ─────────────────────────────────────────────
    # When a (plugin, version, step) group reaches >= threshold reports within
    # the window, fire the alert sink. Webhook URL is the TG-stand-in.
    alert_threshold: int = 5
    alert_window_hours: int = 24
    alert_webhook_url: str = ""

    # ── Monitoring ────────────────────────────────────────────────────────────
    # Background health probes (web container, external URL, TG proxies known
    # from the latest bot heartbeat) run every probe_interval seconds.
    monitoring_probe_interval_seconds: int = 60
    monitoring_bot_stale_seconds: int = 120
    monitoring_web_url: str = "http://stitch-web:8901/health"
    monitoring_external_url: str = "https://stitch.whitebite.ru/health"

    @property
    def plugins_path(self) -> Path:
        p = Path(self.plugins_dir) if self.plugins_dir else _default_data_dir() / "plugins"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def reports_path(self) -> Path:
        p = Path(self.reports_dir) if self.reports_dir else _default_data_dir() / "reports"
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached singleton — safe to call from anywhere."""
    s = Settings()
    if not s.database_url:
        s.database_url = _default_db_url()
    return s


def reset_settings_cache() -> None:
    """Clear the lru_cache — used by tests to pick up env overrides."""
    get_settings.cache_clear()
