"""CloakBrowser profile manager — sync Chromium-based profile launcher using DrissionPage CDP.

Provides consistent anti-detection across all browser automation flows.

Architecture:
- Sync API (no asyncio)
- CloakBrowser subprocess launch
- DrissionPage CDP connection
- Chrome profile locks (SingletonLock)
"""

from __future__ import annotations

import json
import logging
import os
import platform
import re
import shutil
import socket
import subprocess as sp
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from DrissionPage import ChromiumPage

from ..core.paths import get_paths

logger = logging.getLogger(__name__)

DEBUG_TIMING = os.environ.get("STITCH_DEBUG_TIMING", "0") == "1"

DEFAULT_LOCALE = "en-US"
DEFAULT_TIMEZONE_ID = "America/New_York"
DEFAULT_ACCEPT_LANGUAGE = "en-US,en;q=0.9"

DEFAULT_BROWSER_WINDOW = (1920, 1080)
MIN_BROWSER_WINDOW = (800, 600)
MAX_BROWSER_WINDOW = (7680, 4320)


def _safe_stderr(msg: str) -> None:
    try:
        sys.stderr.write(msg.rstrip() + os.linesep)
        sys.stderr.flush()
    except Exception:
        pass


def _find_cloakbrowser() -> str:
    """Find CloakBrowser binary — ONLY CloakBrowser, no system fallback."""
    system = platform.system()
    binary = "chrome.exe" if system == "Windows" else "chrome"

    env_path = os.environ.get("CLOAKBROWSER_BUNDLED_PATH")
    if env_path and Path(env_path).exists():
        logger.info(f"CloakBrowser from env: {env_path}")
        return env_path

    project_root = Path(__file__).resolve().parent.parent.parent.parent
    res_path = project_root / "resources" / "cloakbrowser" / binary
    if res_path.exists():
        logger.info(f"CloakBrowser from resources: {res_path}")
        return str(res_path)

    exe_path = Path(sys.executable).parent / "resources" / "cloakbrowser" / binary
    if exe_path.exists():
        logger.info(f"CloakBrowser from exe dir: {exe_path}")
        return str(exe_path)

    raise RuntimeError(
        "CloakBrowser not found. "
        "Run: python python/autoreg/browser/download_cloakbrowser.py"
    )


def _sanitize_profile_id(raw: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", (raw or "")).strip("._-")
    return cleaned or "default"


def _to_positive_int(value: Any) -> int | None:
    try:
        parsed = int(float(value))
    except Exception:
        return None
    return parsed if parsed > 0 else None


def _normalize_window_tuple(value: Any) -> tuple[int, int] | None:
    if isinstance(value, (tuple, list)) and len(value) >= 2:
        width = _to_positive_int(value[0])
        height = _to_positive_int(value[1])
        if width and height:
            return width, height
    if isinstance(value, dict):
        width = _to_positive_int(value.get("width"))
        height = _to_positive_int(value.get("height"))
        if width and height:
            return width, height
    return None


class CloakBrowserProfileManager:
    """Sync profile manager for CloakBrowser-based Chromium contexts via DrissionPage CDP."""

    def __init__(
        self,
        profile_id: str,
        *,
        profiles_root: str | Path | None = None,
        headless: bool = False,
        proxy: Any = None,
        locale: str | None = None,
        timezone_id: str | None = None,
        geolocation: dict[str, Any] | None = None,
        extra_http_headers: dict[str, str] | None = None,
        window_size: tuple[int, int] | None = None,
        disable_images: bool = False,
        user_agent: str | None = None,
        auto_lock: bool = True,
    ) -> None:
        self.profile_id = _sanitize_profile_id(profile_id)
        self.profiles_root = (
            Path(profiles_root) if profiles_root is not None else get_paths().browser_profiles_dir
        )
        self.profile_path = self.profiles_root / self.profile_id
        self.headless = headless
        self.proxy = proxy
        self.locale = locale or DEFAULT_LOCALE
        self.timezone_id = timezone_id or DEFAULT_TIMEZONE_ID
        self.geolocation = geolocation
        self.extra_http_headers = extra_http_headers or {}
        self.window_size = _normalize_window_tuple(window_size) or DEFAULT_BROWSER_WINDOW
        self.disable_images = disable_images
        self.user_agent = user_agent
        self._auto_lock = auto_lock

        self._page: ChromiumPage | None = None
        self._chrome_proc: sp.Popen | None = None
        self._debug_port: int | None = None
        self._lock: Any | None = None

    def __enter__(self) -> "CloakBrowserProfileManager":
        self.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.stop()

    def _lock_path(self) -> Path:
        return self.profile_path / ".profile.lock"

    def _cleanup_stale_lock(self) -> None:
        lock_path = self._lock_path()
        if not lock_path.exists():
            return
        try:
            lock_path.unlink()
        except Exception:
            pass

    def _acquire_profile_lock(self) -> None:
        self._cleanup_stale_lock()
        try:
            from filelock import FileLock, Timeout
        except Exception as e:
            raise RuntimeError("filelock is required for profile locking") from e

        self.profile_path.mkdir(parents=True, exist_ok=True)
        lock = FileLock(str(self._lock_path()))
        try:
            lock.acquire(timeout=0)
        except Timeout as e:
            self._cleanup_stale_lock()
            try:
                lock.acquire(timeout=0)
            except Timeout:
                raise RuntimeError(
                    f"Profile '{self.profile_id}' is already locked. Path: {self.profile_path}"
                ) from e
        self._lock = lock

    def _release_profile_lock(self) -> None:
        lock = self._lock
        self._lock = None
        if lock is None:
            return
        try:
            lock.release()
        except Exception:
            pass

    def _kill_stale_chrome(self) -> None:
        """Kill Chrome processes using the same profile directory."""
        try:
            import psutil
        except ImportError:
            logger.warning("psutil not available — cannot kill stale Chrome processes")
            return

        profile_abs = os.path.abspath(str(self.profile_path)).lower()
        killed = 0
        for proc in psutil.process_iter(["pid", "name", "cmdline"]):
            try:
                cmdline = proc.info.get("cmdline") or []
                if any("chrome" in (arg or "").lower() for arg in cmdline):
                    if any(profile_abs in (arg or "").lower() for arg in cmdline):
                        proc.kill()
                        killed += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        if killed:
            logger.info(f"Killed {killed} stale Chrome processes for profile")
            time.sleep(0.5)

    def _free_port(self) -> int:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        return port

    def _build_launch_cmd(self, debug_port: int) -> list[str]:
        chrome_path = _find_cloakbrowser()
        cmd = [
            chrome_path,
            f"--user-data-dir={self.profile_path}",
            f"--remote-debugging-port={debug_port}",
            "--profile-directory=Default",
            "--no-first-run",
            "--no-default-browser-check",
            "--start-maximized",
            "--disable-infobars",
            # "--disable-blink-features=AutomationControlled",  # CloakBrowser already anti-detect; flag causes warning bar
            f"--lang={self.locale}",
            f"--accept-lang={self.locale},en",
            "about:blank",
        ]

        if self.headless:
            cmd.append("--headless=new")
            cmd.append("--disable-gpu")

        if self.disable_images:
            cmd.append("--blink-settings=imagesEnabled=false")

        if self.user_agent:
            cmd.append(f"--user-agent={self.user_agent}")

        # Window size (non-headless)
        if not self.headless:
            w, h = self.window_size
            w = max(MIN_BROWSER_WINDOW[0], min(MAX_BROWSER_WINDOW[0], w))
            h = max(MIN_BROWSER_WINDOW[1], min(MAX_BROWSER_WINDOW[1], h))
            cmd.append(f"--window-size={w},{h}")

        # Proxy
        if self.proxy:
            proxy_url = self._parse_proxy(self.proxy)
            if proxy_url:
                cmd.append(f"--proxy-server={proxy_url}")
                logger.info(f"Proxy: {proxy_url}")

        # Load Stitch Toolkit extension (auto-injected for every profile)
        # If Chrome fails to start, comment out the block below to test without extension.
        project_root = Path(__file__).resolve().parent.parent.parent.parent
        ext_path = project_root / "extension" / "stitch-toolkit"
        if ext_path.exists():
            cmd.append(f"--load-extension={ext_path}")
            # NOTE: disable-extensions-except may conflict with other extensions in profile.
            # If Chrome fails to launch, remove the next line or the entire block.
            # cmd.append(f"--disable-extensions-except={ext_path}")
            cmd.append("--disable-background-timer-throttling")
            cmd.append("--disable-renderer-backgrounding")
            logger.info(f"Extension loaded: {ext_path}")
        else:
            logger.warning(f"Stitch Toolkit extension not found at {ext_path}")

        return cmd

    @staticmethod
    def _parse_proxy(proxy: Any) -> str | None:
        if isinstance(proxy, str) and proxy.strip():
            return proxy.strip()
        if isinstance(proxy, dict):
            scheme = proxy.get("scheme") or proxy.get("type") or "http"
            host = proxy.get("host", "")
            port = proxy.get("port", "")
            user = proxy.get("username") or proxy.get("user", "")
            password = proxy.get("password") or proxy.get("pass", "")
            if not host or not port:
                return None
            if user:
                return f"{scheme}://{user}:{password}@{host}:{port}"
            return f"{scheme}://{host}:{port}"
        return None

    def _wait_cdp_ready(self, debug_port: int, timeout: float = 30.0) -> bool:
        import urllib.request as urlreq

        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                req = urlreq.Request(f"http://127.0.0.1:{debug_port}/json/version", method="GET")
                with urlreq.urlopen(req, timeout=3) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    if data.get("webSocketDebuggerUrl"):
                        return True
            except Exception:
                pass
            time.sleep(0.5)
        return False

    def start(self) -> ChromiumPage:
        if self._page is not None:
            return self._page

        t0 = time.time()
        if self._auto_lock:
            self._acquire_profile_lock()
        self._kill_stale_chrome()

        debug_port = self._free_port()
        self._debug_port = debug_port

        chrome_cmd = self._build_launch_cmd(debug_port)
        creationflags = 0x00000008 | 0x00000200 if platform.system() == "Windows" else 0

        logger.info(f"Launching CloakBrowser on port {debug_port}...")
        launch_log = os.path.join(tempfile.gettempdir(), f"cloakbrowser_{debug_port}.log")
        try:
            out = open(launch_log, "w")
        except Exception:
            out = sp.DEVNULL

        self._chrome_proc = sp.Popen(
            chrome_cmd,
            creationflags=creationflags,
            close_fds=True,
            stdout=out,
            stderr=out,
        )
        logger.info(f"CloakBrowser process started (pid={self._chrome_proc.pid})")

        # Give Chrome a moment to initialize
        time.sleep(1.0)

        # Verify Chrome didn't exit immediately
        if self._chrome_proc.poll() is not None:
            exit_code = self._chrome_proc.returncode
            stderr_text = ""
            if out != sp.DEVNULL:
                try:
                    out.flush()
                    with open(launch_log, "r", encoding="utf-8", errors="ignore") as f:
                        stderr_text = f.read(2000)
                except Exception:
                    pass
            raise RuntimeError(
                f"CloakBrowser exited immediately with code {exit_code}. "
                f"Stderr: {stderr_text or '(no output captured)'}")

        if not self._wait_cdp_ready(debug_port, timeout=30.0):
            stderr_text = ""
            if out != sp.DEVNULL:
                try:
                    out.flush()
                    with open(launch_log, "r", encoding="utf-8", errors="ignore") as f:
                        stderr_text = f.read(2000)
                except Exception:
                    pass
            raise RuntimeError(
                f"CloakBrowser CDP not ready on port {debug_port} after 30s. "
                f"Stderr: {stderr_text or '(no output captured)'}")

        logger.info(f"CDP ready, connecting DrissionPage to port {debug_port}...")
        self._page = ChromiumPage(f"127.0.0.1:{debug_port}")
        self._page.set.load_mode("normal")

        # Apply anti-detection spoofing if email/profile-based
        try:
            from autoreg.spoofers.cdp_spoofer import apply_pre_navigation_spoofing
            from autoreg.spoofers.profile_storage import ProfileStorage

            storage_dir = str(get_paths().browser_profiles_dir.parent / "spoof_profiles")
            storage = ProfileStorage(storage_dir)
            profile = storage.get_or_create(self.profile_id)
            apply_pre_navigation_spoofing(self._page, profile)
            logger.info("Anti-detection spoofing applied")
        except Exception as e:
            logger.warning(f"Anti-detection spoofing failed: {e}")

        # Timezone via CDP
        if self.timezone_id:
            try:
                self._page.run_cdp("Emulation.setTimezoneOverride", timezoneId=self.timezone_id)
                logger.info(f"Timezone set: {self.timezone_id}")
            except Exception as e:
                logger.warning(f"Timezone override failed: {e}")

        # Extra headers
        if self.extra_http_headers:
            try:
                self._page.run_cdp(
                    "Network.setExtraHTTPHeaders",
                    headers=self.extra_http_headers,
                )
                logger.info(f"Extra HTTP headers set: {list(self.extra_http_headers.keys())}")
            except Exception as e:
                logger.warning(f"Extra headers failed: {e}")

        # Geolocation via CDP
        if self.geolocation and isinstance(self.geolocation, dict):
            try:
                self._page.run_cdp(
                    "Emulation.setGeolocationOverride",
                    latitude=self.geolocation.get("latitude", 0),
                    longitude=self.geolocation.get("longitude", 0),
                    accuracy=self.geolocation.get("accuracy", 50),
                )
                logger.info(f"Geolocation set: {self.geolocation}")
            except Exception as e:
                logger.warning(f"Geolocation override failed: {e}")

        if DEBUG_TIMING:
            _safe_stderr(f"[CloakBrowserProfileManager] TIMING: start() total: {time.time() - t0:.2f}s")

        logger.info(f"Browser ready (profile: {self.profile_path})")
        return self._page

    def get_page(self) -> ChromiumPage:
        if self._page is None:
            return self.start()
        return self._page

    def open(self, url: str, *, wait_until: str = "load") -> ChromiumPage:
        page = self.get_page()
        page.get(url)
        return page

    def add_cookies(self, cookies: list[dict[str, Any]]) -> None:
        page = self.get_page()
        for c in cookies:
            try:
                cookie: dict[str, Any] = dict(c)
                if "expires" in cookie:
                    try:
                        exp = float(cookie["expires"])
                        if exp > 10_000_000_000:
                            exp = exp / 1000.0
                        cookie["expires"] = exp
                    except Exception:
                        cookie.pop("expires", None)
                page.run_cdp("Network.setCookie", **cookie)
            except Exception as e:
                logger.debug(f"Cookie injection failed: {e}")

    def stop(self) -> None:
        page = self._page
        proc = self._chrome_proc
        self._page = None
        self._chrome_proc = None

        if page is not None:
            try:
                page.quit(timeout=3)
            except Exception:
                pass

        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass

        self._release_profile_lock()


__all__ = ["CloakBrowserProfileManager"]
