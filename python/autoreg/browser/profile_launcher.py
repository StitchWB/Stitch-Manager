"""ProfileLauncher - persistent CloakBrowser profile launcher.

Goals (explicitly safe/stability-only):
- Persistent profile dirs (user_data_dir)
- Proxy parsing + normalization + health-check (fail fast)
- Locale / timezone / Accept-Language defaults (configurable)
- Auto timezone/geolocation resolution via IP-geo lookup when set to "Auto"
- Cookie injection (Playwright cookie list preferred; Netscape cookie file supported)
- File lock on profile dir to prevent concurrent launches

Non-goals (explicitly NOT implemented):
- Any stealth/fingerprint spoofing (canvas/webgl/audio/webrtc/mac/etc.)
"""

from __future__ import annotations

import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Literal, cast

from ..core.paths import get_paths
from .async_shardbrowser_wrapper import AsyncShardBrowserWrapper
from .cloakbrowser_profile_manager import CloakBrowserProfileManager
from .cookie_loader import _load_cookies_from_config
from .engine_state import engine_state_path, load_engine_state, save_engine_state
from .playwright_cdp_attachment import PlaywrightCdpAttachment
from .profile_lock import (
    acquire_profile_lock,
    cleanup_stale_profile_lock,
    profile_lock_path,
    release_profile_lock,
)
from .proxy_geo import _parse_proxy_any, _safe_stderr
from .window_sizing import _resolve_browser_window

logger = logging.getLogger(__name__)

DEBUG_TIMING = os.environ.get("STITCH_DEBUG_TIMING", "0") == "1"


WaitUntil = Literal["commit", "domcontentloaded", "load", "networkidle"]


DEFAULT_LOCALE = "en-US"
DEFAULT_TIMEZONE_ID = "America/New_York"
DEFAULT_ACCEPT_LANGUAGE = "en-US,en;q=0.9"
PROXY_ACCEPT_LANGUAGE_FALLBACK = "en-US,en;q=0.9"


def _is_auto(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() == "auto"


def _normalize_engine(engine: Any) -> str:
    """Normalize engine name to a canonical value.

    - ``shardbrowser`` | ``shardx`` | ``shard`` -> ``shardbrowser``
    - ``cloackbrowser`` (legacy typo) | ``cloakbrowser`` | ``""`` | anything else
      -> ``cloakbrowser``
    """
    value = str(engine or "").lower().strip()
    if value in ("shardbrowser", "shardx", "shard"):
        return "shardbrowser"
    return "cloakbrowser"


def _sanitize_profile_id(raw: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", (raw or "")).strip("._-")
    return cleaned or "default"


class ProfileLauncher:
    """Launches/opens a persistent browser profile with safety utilities.

    CloakBrowser (Chromium) based persistent profile launcher.
    """

    def __init__(
        self,
        *,
        profile_id: str,
        profiles_root: str | Path | None = None,
        headless: bool = False,
        proxy: Any = None,
        config: dict[str, Any] | None = None,
        engine: str = "cloakbrowser",
    ) -> None:
        self.profile_id = _sanitize_profile_id(profile_id)
        self._config: dict[str, Any] = config or {}

        # Honor explicit profile_path from config (passed by Rust via --config-json)
        explicit_profile_path = self._config.get("profile_path")
        if explicit_profile_path:
            self.profile_path = Path(explicit_profile_path)
            self.profiles_root = self.profile_path.parent
        else:
            self.profiles_root = (
                Path(profiles_root) if profiles_root is not None else get_paths().browser_profiles_dir
            )
            self.profile_path = self.profiles_root / self.profile_id
        self.headless = headless
        self.engine = _normalize_engine(engine)

        self._proxy = _parse_proxy_any(proxy if proxy is not None else self._config.get("proxy"))
        self._manager: Any | None = None
        self._lock = None

    async def __aenter__(self) -> ProfileLauncher:
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    def _lock_path(self) -> Path:
        return profile_lock_path(self.profile_path)

    def _cleanup_stale_profile_lock(self) -> None:
        cleanup_stale_profile_lock(
            self.profile_path, self.profile_id, str(self._config.get('worker_email') or '')
        )

    def _acquire_profile_lock(self) -> None:
        self._lock = acquire_profile_lock(
            self.profile_path, self.profile_id, str(self._config.get('worker_email') or '')
        )

    def _release_profile_lock(self) -> None:
        lock = self._lock
        self._lock = None
        release_profile_lock(lock)

    def _effective_locale(self) -> str:
        locale = self._config.get("locale") or self._config.get("browser_locale")
        return str(locale).strip() if isinstance(locale, str) and locale.strip() else DEFAULT_LOCALE

    def _has_explicit_locale(self) -> bool:
        locale = self._config.get("locale") or self._config.get("browser_locale")
        return bool(isinstance(locale, str) and locale.strip() and not _is_auto(locale))

    def _has_explicit_timezone(self) -> bool:
        tz = self._config.get("timezone_id")
        if tz is None:
            tz = self._config.get("timezone")
        return bool(isinstance(tz, str) and tz.strip() and not _is_auto(tz))

    def _effective_timezone(self) -> str | None:
        tz = self._config.get("timezone_id")
        if tz is None:
            tz = self._config.get("timezone")
        if _is_auto(tz):
            return "Auto"
        if isinstance(tz, str) and tz.strip():
            return tz.strip()
        return None

    def _effective_geolocation(self) -> Any:
        geo = self._config.get("geolocation")
        if _is_auto(geo):
            return "Auto"
        return geo

    def _effective_extra_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        raw = self._config.get("extra_http_headers") or self._config.get("headers") or {}
        if isinstance(raw, dict):
            for k, v in raw.items():
                if isinstance(k, str) and isinstance(v, (str, int, float)):
                    headers[k] = str(v)

        # Enforce Accept-Language default if not provided.
        if not any(k.lower() == "accept-language" for k in headers.keys()):
            fallback = self._config.get("accept_language") or (
                PROXY_ACCEPT_LANGUAGE_FALLBACK
                if self._proxy is not None
                else DEFAULT_ACCEPT_LANGUAGE
            )
            headers["Accept-Language"] = fallback
        return headers

    async def start(self) -> Any:
        """Start browser — CloakBrowser based persistent profile."""
        if self._manager is not None:
            if hasattr(self._manager, "start"):
                return await self._manager.start()
            return self._manager

        t0 = time.perf_counter()
        self._acquire_profile_lock()
        t1 = time.perf_counter()
        if DEBUG_TIMING:
            _safe_stderr(f"[ProfileLauncher] TIMING: _acquire_profile_lock: {t1-t0:.2f}s")

        try:
            if self.engine == "shardbrowser":
                return await self._start_shardbrowser()
            return await self._start_cloakbrowser()
        except Exception:
            self._release_profile_lock()
            self._manager = None
            raise

    def _engine_state_path(self) -> Path:
        return engine_state_path(self.profile_path)

    def _load_engine_state(self) -> dict:
        return load_engine_state(self.profile_path)

    def _save_engine_state(self, shard_profile_id: str) -> None:
        save_engine_state(self.profile_path, shard_profile_id)

    async def _start_shardbrowser(self) -> AsyncShardBrowserWrapper:
        """Start ShardBrowser (ShardX) persistent profile session.

        The ShardX SDK owns the profile directory (fingerprint + cookies in
        its cache), binds the proxy and resolves geo/timezone before launch.
        ``shard_profile_id`` from config reuses the account's saved profile so
        the interactive session matches the registration fingerprint. When the
        config omits it (standalone launch), the persisted ``engine_state.json``
        is used so the same ShardX profile is reused across launches rather than
        creating a fresh identity every time.
        """
        proxy_url = self._proxy.to_url(include_auth=True) if self._proxy else None
        shard_profile_id = (
            self._config.get("shard_profile_id")
            or self._config.get("shardProfileId")
        )
        if not shard_profile_id:
            shard_profile_id = self._load_engine_state().get("shard_profile_id")
        wrapper = AsyncShardBrowserWrapper(
            shard_profile_id=shard_profile_id,
            proxy=proxy_url,
            headless=self.headless,
            platform=str(self._config.get("shard_platform") or "Windows"),
        )
        await wrapper.start()
        self._manager = wrapper

        effective_id = wrapper.shard_profile_id
        if effective_id:
            self._save_engine_state(effective_id)

        # Cookie injection (Playwright cookie dicts — native patchright API)
        cookies = _load_cookies_from_config(self._config)
        if cookies:
            await wrapper.add_cookies(cookies)

        return wrapper

    async def _start_cloakbrowser(self) -> Any:
        """Start CloakBrowser and drive it with real Playwright over CDP."""
        proxy_url = self._proxy.to_url(include_auth=True) if self._proxy else None
        tz = self._effective_timezone()
        geo = self._effective_geolocation()

        resolved_window, maximize_on_start = _resolve_browser_window(
            self._config,
            current_window=None,
        )

        # auto_lock=False: launcher already holds the profile lock, so the manager must not re-acquire it.
        manager = CloakBrowserProfileManager(
            profile_id=self.profile_id,
            profiles_root=self.profiles_root,
            profile_path=self.profile_path,
            headless=self.headless,
            proxy=proxy_url,
            locale=self._effective_locale(),
            timezone_id=tz if tz != "Auto" else None,
            geolocation=geo if isinstance(geo, dict) else None,
            window_size=resolved_window,
            auto_lock=False,
            maximize_on_start=maximize_on_start,
        )

        attachment = PlaywrightCdpAttachment(manager)
        await attachment.start()
        self._manager = attachment

        cookies = _load_cookies_from_config(self._config)
        if cookies:
            await attachment.add_cookies(cookies)

        return attachment

    async def open(
        self,
        url: str,
        *,
        wait_until: WaitUntil = "domcontentloaded",
        prefer_existing: bool = False,
    ) -> Any:
        if not url:
            raise ValueError("url is required")
        if self._manager is None:
            await self.start()
        assert self._manager is not None

        # Get page — engine-agnostic
        if hasattr(self._manager, "get_page"):
            page = await self._manager.get_page()
        elif hasattr(self._manager, "get"):
            page = await self._manager.get(url)
        else:
            raise RuntimeError("Browser manager has no get_page or get method")

        if prefer_existing:
            try:
                current_url = str(page.url or "").strip()
            except Exception:
                current_url = ""
            if current_url and current_url not in ("about:blank", "about:newtab"):
                return page

        target_url = str(url).strip()
        try:
            current_url = str(page.url or "").strip()
        except Exception:
            current_url = ""

        # Avoid redundant navigation to the same location on persistent tabs.
        if current_url and current_url.rstrip("/") == target_url.rstrip("/"):
            return page

        try:
            try:
                page_state = "unknown"
                if hasattr(page, 'is_closed'):
                    page_state = "closed" if page.is_closed() else "open"
                _safe_stderr(f"[ProfileLauncher] Navigating to {target_url} (page state: {page_state}, wait_until: {wait_until})")
            except Exception as diag_err:
                _safe_stderr(f"[ProfileLauncher] Could not check page state: {diag_err}")

            await page.goto(target_url, wait_until=cast(WaitUntil, wait_until))
            _safe_stderr(f"[ProfileLauncher] Navigation successful to {target_url}")
        except Exception as e:
            err_msg = str(e)
            if "NS_BINDING_ABORTED" in err_msg:
                try:
                    if not page.is_closed():
                        return page
                except Exception:
                    pass
            # NS_ERROR_PROXY_CONNECTION_REFUSED: proxy is dead but browser is alive.
            if "PROXY_CONNECTION_REFUSED" in err_msg or "proxy_connection_refused" in err_msg.lower():
                _safe_stderr(
                    f"[ProfileLauncher] Proxy refused for {target_url}, opening about:blank instead. "
                    f"Use the overlay to switch proxy."
                )
                try:
                    await page.goto("about:blank", wait_until="domcontentloaded")
                except Exception:
                    pass
                return page
            # Handle [Errno 22] Invalid argument - try without wait_until as fallback
            if "invalid argument" in err_msg.lower() or err_msg == "[Errno 22] Invalid argument":
                _safe_stderr(f"[ProfileLauncher] Navigation failed with '{err_msg}', retrying without wait_until parameter...")
                try:
                    await page.goto(target_url)
                    _safe_stderr("[ProfileLauncher] Navigation successful on retry (no wait_until)")
                    return page
                except Exception as retry_err:
                    _safe_stderr(f"[ProfileLauncher] Retry also failed: {retry_err}")
                    raise
            raise
        return page

    async def close(self) -> None:
        manager = self._manager
        self._manager = None
        try:
            if manager is not None:
                await manager.stop()
        finally:
            self._release_profile_lock()
