"""
Base browser automation class for provider implementations.

This module provides a reusable base class for browser automation across different
providers (GitHub, Kiro, etc.). It handles common browser setup, configuration,
and cleanup operations using DrissionPage.
"""

import logging
import os
import platform
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

from DrissionPage import ChromiumOptions, ChromiumPage

logger = logging.getLogger(__name__)

# Launch method constants
LAUNCH_DIRECT = "direct"          # Launch Chrome directly (standard DrissionPage)
LAUNCH_CLOAKBROWSER = "cloakbrowser"  # Launch via CloakBrowser profile manager
LAUNCH_SHARDBROWSER = "shardbrowser"  # Launch via ShardBrowser SDK (patchright async)


class BaseBrowser:
    """
    Base class for browser automation with DrissionPage.

    Supports three browser engines controlled by *launch_method*:

    * ``LAUNCH_DIRECT`` (default) — standard DrissionPage / CloakBrowser.
    * ``LAUNCH_CLOAKBROWSER`` — alias, same path as DIRECT (CloakBrowser is
      detected automatically inside ``_find_chrome_path``).
    * ``LAUNCH_SHARDBROWSER`` — ShardBrowser SDK (``shardx`` Python package,
      patchright-based async Playwright).  When selected the class manages a
      ``shardx`` session instead of a ``ChromiumPage``.  ``self.page`` holds a
      synchronous Playwright ``Page`` proxy; CDP helpers are not available.

    Provides common functionality for:
    - Browser initialization with ChromiumOptions / ShardX SDK
    - Chrome executable path detection
    - User data directory management
    - Cookie and storage clearing
    - Window management
    - Clean shutdown

    Attributes:
        page: ChromiumPage (DIRECT/CLOAK) or sync Playwright Page (SHARDBROWSER)
        headless: Whether browser runs in headless mode
    """

    def __init__(
        self,
        headless: bool = False,
        user_data_dir: str | None = None,
        clear_cookies: bool = True,
        proxy_enabled: bool = False,
        proxy_type: str = 'http',
        proxy_url: str | None = None,
        proxy_username: str | None = None,
        proxy_password: str | None = None,
        launch_method: str = LAUNCH_DIRECT,
        cloakbrowser_required: bool = False,
        cloakbrowser_auto_download: bool = True,
        clear_origins: list | None = None,
        # ShardBrowser-specific
        shardbrowser_profile_id: str | None = None,
        shardbrowser_platform: str = "Windows",
    ):
        """
        Initialize browser automation.

        Args:
            headless: Run browser without GUI (default: False)
            user_data_dir: Custom user data directory for persistent profile.
                          If None, creates temporary profile that's deleted on close.
            clear_cookies: Clear cookies and storage on initialization (default: True).
                          Set to False to preserve existing session.
            proxy_enabled: Enable proxy for browser
            proxy_type: Proxy type (http or socks5)
            proxy_url: Proxy URL (host:port or full URL for ShardBrowser)
            proxy_username: Proxy username (DIRECT/CLOAK only; embed in proxy_url for ShardBrowser)
            proxy_password: Proxy password (DIRECT/CLOAK only)
            launch_method: LAUNCH_DIRECT | LAUNCH_CLOAKBROWSER | LAUNCH_SHARDBROWSER
            cloakbrowser_required: Whether CloakBrowser is required (fail if not found)
            cloakbrowser_auto_download: Whether to auto-download CloakBrowser if missing
            clear_origins: List of origin URLs to clear cookies/storage for
            shardbrowser_profile_id: Re-use an existing ShardBrowser saved profile ID.
                                     If None a new random profile is created each run.
            shardbrowser_platform: Fingerprint platform filter passed to ShardX SDK
                                   when creating a new profile (default: "Windows").
        """
        self.headless = headless
        self.page: ChromiumPage | None = None
        self._user_data_dir = user_data_dir
        self._clear_cookies = clear_cookies
        self._temp_profile: str | None = None
        self._proxy_enabled = proxy_enabled
        self._proxy_type = proxy_type
        self._proxy_url = proxy_url
        self._proxy_username = proxy_username
        self._proxy_password = proxy_password
        self._launch_method = launch_method
        self._cloakbrowser_required = cloakbrowser_required
        self._cloakbrowser_auto_download = cloakbrowser_auto_download
        self._clear_origins = clear_origins or []
        # ShardBrowser state
        self._shardbrowser_profile_id = shardbrowser_profile_id
        self._shardbrowser_platform = shardbrowser_platform
        self._shard_sdk: object | None = None    # shardx.ShardX instance
        self._shard_browser: object | None = None  # shardx BrowserSession

        # Initialize browser
        self._init_browser()

    def _find_chrome_path(self) -> str | None:
        """
        Find Chrome/Chromium executable path on different platforms.

        Priority:
        1. CloakBrowser (bundled anti-detect browser)
        2. Windows Registry (installed Chrome)
        3. Common installation paths

        Returns:
            Path to Chrome executable, or None if not found
        """
        system = platform.system()
        possible_paths = []

        # --- Priority 1: CloakBrowser (bundled anti-detect browser) ---
        # 1a. Bundled path passed via env var (cross-platform)
        bundled_env = os.environ.get("CLOAKBROWSER_BUNDLED_PATH")
        if bundled_env and Path(bundled_env).exists():
            logger.info(f"Found CloakBrowser (bundled): {bundled_env}")
            return bundled_env

        # 1b. Resource directory (production layout: <app>/resources/cloakbrowser/)
        script_dir = Path(__file__).resolve().parent
        project_root = script_dir.parent.parent.parent
        possible_bundled = [
            # Dev layout (project root)
            project_root / "resources" / "cloakbrowser" / ("chrome.exe" if system == "Windows" else "chrome"),
            # Production: next to Python binary (if bundled)
            Path(sys.executable).parent / "resources" / "cloakbrowser" / ("chrome.exe" if system == "Windows" else "chrome"),
            # Production: parent of Python binary (some PyInstaller layouts)
            Path(sys.executable).parent.parent / "resources" / "cloakbrowser" / ("chrome.exe" if system == "Windows" else "chrome"),
        ]
        for path in possible_bundled:
            if path.exists():
                logger.info(f"Found CloakBrowser (bundled): {path}")
                return str(path)

        # Attempt auto-download on first run if enabled
        if os.environ.get("AUTOREG_AUTO_DOWNLOAD_CLOAKBROWSER", "1") == "1":
            download_script = project_root / "python" / "autoreg" / "browser" / "download_cloakbrowser.py"
            if download_script.exists():
                logger.info("CloakBrowser not found — attempting auto-download...")
                try:
                    result = subprocess.run(
                        [sys.executable, str(download_script)],
                        capture_output=True, text=True, timeout=600,
                    )
                    downloaded = project_root / "resources" / "cloakbrowser" / ("chrome.exe" if system == "Windows" else "chrome")
                    if result.returncode == 0 and downloaded.exists():
                        logger.info(f"CloakBrowser auto-downloaded: {downloaded}")
                        return str(downloaded)
                    else:
                        logger.warning(f"Auto-download failed: {result.stderr}")
                except Exception as e:
                    logger.warning(f"Auto-download error: {e}")

        if system == "Windows":
            logger.debug("OS detected: Windows")

            # Try Windows Registry first
            try:
                import winreg

                for root, key_path in [
                    (
                        winreg.HKEY_LOCAL_MACHINE,
                        r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
                    ),
                    (
                        winreg.HKEY_CURRENT_USER,
                        r"Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
                    ),
                ]:
                    try:
                        with winreg.OpenKey(root, key_path) as key:
                            chrome_path, _ = winreg.QueryValueEx(key, "")
                            if os.path.exists(chrome_path):
                                logger.info(f"Found Chrome via registry: {chrome_path}")
                                return str(chrome_path)
                    except FileNotFoundError:
                        continue
            except ImportError:
                logger.warning("winreg module not available")

            # Fallback to common paths
            possible_paths.extend([
                os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
                os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
                os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
                os.path.expandvars(r"%ProgramFiles%\Chromium\Application\chrome.exe"),
                os.path.expandvars(r"%LocalAppData%\Chromium\Application\chrome.exe"),
                os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
                os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            ])

        elif system == "Darwin":  # macOS
            logger.debug("OS detected: macOS")
            possible_paths.extend([
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
                os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            ])

        else:  # Linux
            logger.debug(f"OS detected: {system}")
            possible_paths.extend([
                "/usr/bin/google-chrome",
                "/usr/bin/google-chrome-stable",
                "/usr/bin/chromium",
                "/usr/bin/chromium-browser",
                "/snap/bin/chromium",
            ])

        # Check all possible paths
        for path in possible_paths:
            if os.path.exists(path):
                logger.info(f"Found Chrome at: {path}")
                return path

        logger.warning("Chrome executable not found in any checked locations")
        return None

    def _setup_chrome_options(self) -> ChromiumOptions:
        """
        Configure ChromiumOptions with common settings.

        Sets up:
        - User data directory (persistent or temporary)
        - Headless mode configuration
        - Window size and maximization
        - Language settings (English)
        - Automation detection hiding
        - Logging configuration

        Returns:
            Configured ChromiumOptions instance
        """
        options = ChromiumOptions()

        # Setup user data directory
        if self._user_data_dir:
            profile_path = self._user_data_dir
            logger.info(f"Using custom profile: {profile_path}")
        else:
            # Create temporary profile
            profile_path = os.path.join(
                tempfile.gettempdir(),
                f'browser_chrome_{uuid.uuid4().hex[:8]}'
            )
            self._temp_profile = profile_path
            logger.info(f"Using temp profile: {profile_path}")

        options.set_user_data_path(profile_path)
        options.auto_port()  # Automatically find free port

        # Find and set Chrome executable path
        chrome_path = self._find_chrome_path()
        if chrome_path:
            options.set_browser_path(chrome_path)
            logger.info(f"Using browser executable: {chrome_path}")

        # Headless mode configuration
        if self.headless:
            options.headless()
            options.set_argument('--disable-gpu')
            options.set_argument('--no-sandbox')
            options.set_argument('--disable-dev-shm-usage')
            options.set_argument('--disable-software-rasterizer')
            options.set_argument('--disable-extensions')
            options.set_argument('--remote-debugging-port=0')

        # Hide automation indicators
        options.set_argument('--disable-infobars')
        options.set_argument('--no-first-run')
        options.set_argument('--no-default-browser-check')

        # Reduce Chrome logs
        options.set_argument('--disable-logging')
        options.set_argument('--log-level=3')  # Only fatal errors

        # Force English language
        options.set_argument('--lang=en-US')
        options.set_argument('--accept-lang=en-US,en')

        # Window size - large for correct UI display
        options.set_argument('--window-size=1920,1080')
        options.set_argument('--start-maximized')

        # Incognito mode for clean session (if not using persistent profile)
        if not self._user_data_dir:
            options.set_argument('--incognito')

        # Configure proxy if enabled
        if self._proxy_enabled and self._proxy_url:
            logger.info(f"Configuring {self._proxy_type} proxy: {self._proxy_url}")

            # Parse proxy URL (format: host:port)
            if ':' in self._proxy_url:
                host, port = self._proxy_url.split(':', 1)
            else:
                host = self._proxy_url
                port = '8080'  # default

            # Build proxy string based on type.
            # socks5h:// resolves DNS on the proxy side (remote), preventing DNS
            # leaks. socks5:// resolves DNS locally via the system resolver,
            # leaking target domains.
            #
            # Chrome limitation: Chrome's --proxy-server flag does NOT recognize
            # the socks5h:// scheme (only http/socks/socks4/socks5). However,
            # Chrome's SOCKS5 implementation already does remote DNS resolution
            # by default, so socks5:// in Chrome is already leak-free. The
            # socks5h:// scheme is honoured by Playwright/patchright (ShardBrowser
            # engine) and Python HTTP clients (aiohttp, requests).
            if self._proxy_username and self._proxy_password:
                if self._proxy_type == 'socks5':
                    proxy_str = f"socks5h://{self._proxy_username}:{self._proxy_password}@{host}:{port}"
                else:  # http
                    proxy_str = f"http://{self._proxy_username}:{self._proxy_password}@{host}:{port}"
            else:
                if self._proxy_type == 'socks5':
                    proxy_str = f"socks5h://{host}:{port}"
                else:  # http
                    proxy_str = f"http://{host}:{port}"

            # Set proxy in ChromiumOptions
            options.set_proxy(proxy_str)
            logger.info(f"Proxy configured: {proxy_str}")

        return options

    def _init_browser(self) -> None:
        """
        Initialize the browser engine selected by *launch_method*.

        * ``LAUNCH_DIRECT`` / ``LAUNCH_CLOAKBROWSER`` — creates a
          ``ChromiumPage`` via DrissionPage (existing behaviour).
        * ``LAUNCH_SHARDBROWSER`` — creates a ShardX session (patchright).
          ``self.page`` is set to a thin synchronous proxy so the rest of the
          provider code can call ``.get(url)``, ``.ele(sel)`` etc. without
          knowing which engine is in use.
        """
        if self._launch_method == LAUNCH_SHARDBROWSER:
            self._init_shardbrowser()
            return

        # ── Original DrissionPage / CloakBrowser path ──────────────────────
        options = self._setup_chrome_options()

        logger.info(f"Initializing ChromiumPage (headless={self.headless})...")
        self.page = ChromiumPage(options)
        logger.info("ChromiumPage initialized successfully")

        # Wait for Chrome CDP connection
        logger.debug("Waiting for Chrome CDP connection...")
        cdp_ready = False
        for attempt in range(30):  # 3 seconds maximum
            try:
                self.page.run_cdp('Browser.getVersion')
                logger.debug(f'Chrome CDP ready after {attempt * 0.1:.1f}s')
                cdp_ready = True
                break
            except Exception as e:
                if attempt == 29:
                    logger.error(f'Chrome CDP connection timeout after 3s: {e}')
                    raise RuntimeError(f"Chrome CDP connection failed: {e}") from None
                time.sleep(0.1)

        # Maximize window for correct UI display (non-headless only)
        if not self.headless:
            try:
                self.page.set.window.max()
                logger.debug("Window maximized")
            except RuntimeError:
                # Fallback: set large size manually
                try:
                    self.page.set.window.size(1920, 1080)
                    logger.debug("Window resized to 1920x1080")
                except RuntimeError:
                    pass

        # Clear cookies and storage for clean session
        if self._clear_cookies and cdp_ready:
            try:
                self.page.run_cdp('Network.clearBrowserCookies')
                self.page.run_cdp('Network.clearBrowserCache')
                # Clear storage for specific origins if provided
                for origin in self._clear_origins:
                    try:
                        self.page.run_cdp('Storage.clearDataForOrigin', origin=origin, storageTypes='all')
                    except Exception:  # noqa: BLE001
                        pass
                logger.info("Cookies and storage cleared")
            except RuntimeError as e:
                logger.warning(f"Failed to clear cookies: {e}")

    # ── ShardBrowser engine ───────────────────────────────────────────────────

    def _init_shardbrowser(self) -> None:
        """Launch a ShardX engine and drive it via DrissionPage over CDP.

        The shardx SDK spawns the patched Chromium (engine-level spoofing)
        with a remote-debugging port and returns the CDP endpoint; we attach
        a regular ``ChromiumPage`` to it.  No asyncio bridging is needed, so
        the synchronous provider code works unchanged and gets the full
        native DrissionPage API (get/ele/run_cdp/...).

        The SDK auto-downloads the patched Chromium engine + fingerprint
        library on the first call (~170 MB, cached afterwards).

        Requires:  ``pip install shardx``
        """
        from importlib.util import find_spec
        from urllib.parse import urlparse

        if find_spec("shardx") is None:
            raise RuntimeError(
                "ShardBrowser engine requires the 'shardx' package. "
                "Install it with:  pip install shardx"
            )

        from .async_shardbrowser_wrapper import build_shard_sdk, create_shard_profile

        # Build proxy URL: ShardBrowser expects a full URI like
        # "socks5h://user:pass@host:port" or "http://host:port".
        # socks5h:// resolves DNS on the proxy side (remote), preventing DNS
        # leaks.
        proxy_uri: str | None = None
        if self._proxy_enabled and self._proxy_url:
            if "://" in self._proxy_url:
                proxy_uri = self._proxy_url  # already a full URI
            else:
                scheme = "socks5h" if self._proxy_type == "socks5" else "http"
                if self._proxy_username and self._proxy_password:
                    proxy_uri = (
                        f"{scheme}://{self._proxy_username}:{self._proxy_password}"
                        f"@{self._proxy_url}"
                    )
                else:
                    proxy_uri = f"{scheme}://{self._proxy_url}"

        sdk = build_shard_sdk()
        self._shard_sdk = sdk

        # Re-use a saved profile (persistent fingerprint + cookies) when an
        # ID was provided; otherwise create a fresh random Windows profile.
        profile = None
        if self._shardbrowser_profile_id:
            try:
                profile = sdk.open_profile(self._shardbrowser_profile_id)
                logger.info(
                    "ShardBrowser: reusing saved profile %s",
                    self._shardbrowser_profile_id,
                )
            except Exception:
                logger.warning(
                    "ShardBrowser: saved profile %s not found, creating new one",
                    self._shardbrowser_profile_id,
                )
        if profile is None:
            profile = create_shard_profile(sdk, self._shardbrowser_platform)
            logger.info(
                "ShardBrowser: created new %s profile id=%s",
                self._shardbrowser_platform,
                getattr(profile, "id", "?"),
            )

        # Store profile id so the caller can persist it
        self._shardbrowser_profile_id = getattr(profile, "id", self._shardbrowser_profile_id)

        # Spawn the engine with a CDP endpoint (synchronous, no event loop).
        sess = sdk.launch(
            profile,
            proxy=proxy_uri,
            headless=self.headless,
            cdp=True,
        )
        if not sess.cdp_url:
            sess.stop()
            raise RuntimeError("ShardBrowser engine failed to expose a CDP endpoint")

        # Attach DrissionPage to the running engine (host:port from ws url).
        from DrissionPage import ChromiumOptions, ChromiumPage

        address = urlparse(sess.cdp_url).netloc
        try:
            options = ChromiumOptions()
            options.set_address(address)
            options.set_argument('--disable-infobars')
            options.set_argument('--no-first-run')
            options.set_argument('--no-default-browser-check')
            options.set_argument('--disable-logging')
            options.set_argument('--log-level=3')
            page = ChromiumPage(addr_or_opts=options)
        except Exception:
            # Never leave the engine process orphaned on attach failure.
            sess.stop()
            raise
        # BrowserSession owns the engine process; stop() terminates it.
        self._shard_browser = sess
        self.page = page

        logger.info(
            "ShardBrowser initialised (profile_id=%s, proxy=%s, cdp=%s)",
            self._shardbrowser_profile_id,
            proxy_uri or "none",
            address,
        )

    @property
    def shard_profile_id(self) -> str | None:
        """ShardX saved profile id in use (None unless ShardBrowser engine)."""
        return self._shardbrowser_profile_id

    def navigate(self, url: str, timeout: float = 10.0) -> None:
        """
        Navigate to URL.

        Args:
            url: URL to navigate to
            timeout: Page load timeout in seconds (default: 10.0)

        Raises:
            RuntimeError: If navigation fails or page not initialized
        """
        if not self.page:
            raise RuntimeError("Browser not initialized")

        logger.info(f"Navigating to: {url}")
        self.page.get(url, timeout=timeout)

    @property
    def current_url(self) -> str:
        """
        Get current page URL.

        Returns:
            Current URL as string

        Raises:
            RuntimeError: If page not initialized
        """
        if not self.page:
            raise RuntimeError("Browser not initialized")
        return self.page.url

    def persist_profile(self, target_dir: str) -> str:
        """Copy temp profile to a persistent location.

        Call this BEFORE close() to save the browser session for later reuse.
        The temp profile is copied to target_dir. The original temp directory
        is still cleaned up by close().

        Args:
            target_dir: Target directory for persistent profile.

        Returns:
            Path to the persistent profile (target_dir).
        """
        if not self._temp_profile or not os.path.exists(self._temp_profile):
            logger.warning("No temp profile to persist")
            return target_dir

        import shutil

        try:
            # Ensure target directory exists
            os.makedirs(target_dir, exist_ok=True)

            # Copy all contents from temp to persistent
            for item in os.listdir(self._temp_profile):
                src = os.path.join(self._temp_profile, item)
                dst = os.path.join(target_dir, item)
                if os.path.isdir(src):
                    if os.path.exists(dst):
                        shutil.rmtree(dst, ignore_errors=True)
                    shutil.copytree(src, dst)
                else:
                    shutil.copy2(src, dst)

            logger.info(f"Browser profile persisted to: {target_dir}")
            return target_dir
        except Exception as e:
            logger.error(f"Failed to persist browser profile: {e}")
            return target_dir

    def close(self) -> None:
        """
        Close browser and cleanup resources.

        Handles both DrissionPage (DIRECT/CLOAK) and ShardBrowser engines.
        Safe to call multiple times.
        """
        # ── ShardBrowser cleanup ─────────────────────────────────────────────
        if self._launch_method == LAUNCH_SHARDBROWSER:
            page, self.page = self.page, None
            sess, self._shard_browser = self._shard_browser, None
            self._shard_sdk = None
            try:
                if sess is not None:
                    sess.stop()  # terminates the engine process
                if page is not None:
                    try:
                        page.quit()
                    except Exception:  # noqa: BLE001
                        pass
            except Exception as exc:  # noqa: BLE001
                logger.warning("ShardBrowser close error: %s", exc)
            logger.info("ShardBrowser closed")
            return

        # ── DrissionPage cleanup ─────────────────────────────────────────────
        if self.page:
            try:
                self.page.quit()
                logger.info("Browser closed")
            except Exception as e:
                logger.warning(f"Error closing browser: {e}")
            finally:
                self.page = None

        # Cleanup temporary profile (only if not persistent)
        if (self._temp_profile and os.path.exists(self._temp_profile)
                and getattr(self, '_cleanup_profile_on_close', True)):
            try:
                import shutil
                shutil.rmtree(self._temp_profile, ignore_errors=True)
                logger.debug(f"Cleaned up temp profile: {self._temp_profile}")
            except Exception as e:
                logger.warning(f"Failed to cleanup temp profile: {e}")

