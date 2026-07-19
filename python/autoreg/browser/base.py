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
from typing import Optional

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
        user_data_dir: Optional[str] = None,
        clear_cookies: bool = True,
        proxy_enabled: bool = False,
        proxy_type: str = 'http',
        proxy_url: Optional[str] = None,
        proxy_username: Optional[str] = None,
        proxy_password: Optional[str] = None,
        launch_method: str = LAUNCH_DIRECT,
        cloakbrowser_required: bool = False,
        cloakbrowser_auto_download: bool = True,
        clear_origins: Optional[list] = None,
        # ShardBrowser-specific
        shardbrowser_profile_id: Optional[str] = None,
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
        self.page: Optional[ChromiumPage] = None
        self._user_data_dir = user_data_dir
        self._clear_cookies = clear_cookies
        self._temp_profile: Optional[str] = None
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
        self._shard_sdk: Optional[object] = None    # shardx.ShardX instance
        self._shard_browser: Optional[object] = None  # patchright Browser
        self._shard_loop: Optional[object] = None   # asyncio event loop
        
        # Initialize browser
        self._init_browser()
    
    def _find_chrome_path(self) -> Optional[str]:
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
        # 1a. Tauri-bundled path passed via env var (cross-platform)
        bundled_env = os.environ.get("CLOAKBROWSER_BUNDLED_PATH")
        if bundled_env and Path(bundled_env).exists():
            logger.info(f"Found CloakBrowser (Tauri bundled): {bundled_env}")
            return bundled_env

        # 1b. Tauri resource directory (production layout: <app>/resources/cloakbrowser/)
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
            
            # Build proxy string based on type
            if self._proxy_username and self._proxy_password:
                if self._proxy_type == 'socks5':
                    proxy_str = f"socks5://{self._proxy_username}:{self._proxy_password}@{host}:{port}"
                else:  # http
                    proxy_str = f"http://{self._proxy_username}:{self._proxy_password}@{host}:{port}"
            else:
                if self._proxy_type == 'socks5':
                    proxy_str = f"socks5://{host}:{port}"
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
                    raise RuntimeError(f"Chrome CDP connection failed: {e}")
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
        """Launch a ShardX (patchright) browser session.

        ShardX SDK is fully async (asyncio + patchright).  We run it inside a
        dedicated event loop on the current thread so the rest of the
        (synchronous) provider code works unchanged.

        The SDK auto-downloads the patched Chromium 149 engine + fingerprint
        library on the first call (~170 MB, cached afterwards).

        Requires:  ``pip install shardx``
        """
        try:
            import asyncio as _asyncio

            import shardx as _shardx  # type: ignore[import-untyped]
        except ImportError:
            raise RuntimeError(
                "ShardBrowser engine requires the 'shardx' package. "
                "Install it with:  pip install shardx"
            )

        # Build proxy URL: ShardBrowser expects a full URI like
        # "socks5://user:pass@host:port" or "http://host:port"
        proxy_uri: Optional[str] = None
        if self._proxy_enabled and self._proxy_url:
            if "://" in self._proxy_url:
                proxy_uri = self._proxy_url  # already a full URI
            else:
                scheme = "socks5" if self._proxy_type == "socks5" else "http"
                if self._proxy_username and self._proxy_password:
                    proxy_uri = (
                        f"{scheme}://{self._proxy_username}:{self._proxy_password}"
                        f"@{self._proxy_url}"
                    )
                else:
                    proxy_uri = f"{scheme}://{self._proxy_url}"

        # One dedicated event loop for the lifetime of this browser instance
        loop = _asyncio.new_event_loop()
        self._shard_loop = loop

        async def _start() -> None:
            sdk = _shardx.ShardX()
            self._shard_sdk = sdk

            # Re-use a saved profile (persistent fingerprint + cookies) when an
            # ID was provided; otherwise create a fresh random Windows profile.
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
                    profile = sdk.create_profile(platform=self._shardbrowser_platform)
            else:
                profile = sdk.create_profile(platform=self._shardbrowser_platform)
                logger.info(
                    "ShardBrowser: created new %s profile id=%s",
                    self._shardbrowser_platform,
                    getattr(profile, "id", "?"),
                )

            # Store profile id so the caller can persist it
            self._shardbrowser_profile_id = getattr(profile, "id", self._shardbrowser_profile_id)

            browser = await sdk.session(
                profile,
                proxy=proxy_uri,
                headless=self.headless,
            ).__aenter__()
            self._shard_browser = browser

            # Grab the first (and only) context + page
            ctx = browser.contexts[0]
            raw_page = await ctx.new_page()

            # Wrap the async patchright Page in a thin synchronous adapter so
            # provider code can call page.get(url), page.url, page.run_js() etc.
            self.page = _ShardPageAdapter(raw_page, loop)  # type: ignore[assignment]

        loop.run_until_complete(_start())
        logger.info(
            "ShardBrowser initialised (profile_id=%s, proxy=%s)",
            self._shardbrowser_profile_id,
            proxy_uri or "none",
        )
    
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
            loop = self._shard_loop
            browser = self._shard_browser
            sdk = self._shard_sdk
            self.page = None
            self._shard_browser = None
            self._shard_sdk = None
            if loop and not loop.is_closed():
                async def _close_shard():
                    if browser:
                        try:
                            await browser.close()
                        except Exception:  # noqa: BLE001
                            pass
                try:
                    loop.run_until_complete(_close_shard())
                except Exception as exc:  # noqa: BLE001
                    logger.warning("ShardBrowser close error: %s", exc)
                finally:
                    loop.close()
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


# ─────────────────────────────────────────────────────────────────────────────
# ShardBrowser synchronous page adapter
# ─────────────────────────────────────────────────────────────────────────────

class _ShardPageAdapter:
    """Thin synchronous wrapper around a patchright async ``Page``.

    Exposes the subset of the DrissionPage API used by the Kiro provider:
    ``get(url)``, ``ele(sel, timeout)``, ``eles(sel)``, ``url``, ``run_js()``,
    ``run_cdp()``, ``refresh()``, ``wait.doc_loaded()``.

    All async patchright calls are dispatched onto the *loop* that was
    created by ``BaseBrowser._init_shardbrowser``.
    """

    def __init__(self, raw_page: object, loop: object) -> None:
        self._page = raw_page    # patchright Page
        self._loop = loop        # asyncio.AbstractEventLoop

    # ── Internal runner ───────────────────────────────────────────────────────

    def _run(self, coro):
        """Run a coroutine synchronously on the browser event loop."""
        import asyncio as _asyncio
        future = _asyncio.run_coroutine_threadsafe(coro, self._loop)  # type: ignore[arg-type]
        return future.result(timeout=60)

    # ── Navigation ────────────────────────────────────────────────────────────

    def get(self, url: str, timeout: float = 10.0) -> None:
        self._run(self._page.goto(url, timeout=int(timeout * 1000)))  # type: ignore[union-attr]

    def refresh(self) -> None:
        self._run(self._page.reload())  # type: ignore[union-attr]

    @property
    def url(self) -> str:
        return self._page.url  # type: ignore[union-attr]

    # ── Element lookup (returns _ShardElementAdapter or None) ─────────────────

    def ele(self, selector: str, timeout: float = 1.0) -> Optional["_ShardElementAdapter"]:
        """Find the first element matching *selector*.

        Translates DrissionPage selector syntax to Playwright locator:
        - ``text=Foo`` → ``page.get_by_text("Foo")``
        - ``@attr=val`` → ``[attr="val"]`` CSS attribute selector
        - ``css:…`` / ``xpath:…`` → passed through
        - Everything else → treated as CSS selector
        """
        locator = _shard_selector_to_locator(self._page, selector)
        try:
            handle = self._run(
                locator.first.element_handle(timeout=int(timeout * 1000))
            )
            if handle is None:
                return None
            return _ShardElementAdapter(handle, locator.first, self._loop)
        except Exception:  # noqa: BLE001
            return None

    def eles(self, selector: str) -> list:
        """Return all elements matching *selector*."""
        locator = _shard_selector_to_locator(self._page, selector)
        try:
            handles = self._run(locator.element_handles())
            return [
                _ShardElementAdapter(h, locator.nth(i), self._loop)
                for i, h in enumerate(handles)
            ]
        except Exception:  # noqa: BLE001
            return []

    # ── JavaScript ────────────────────────────────────────────────────────────

    def run_js(self, script: str, *args) -> object:
        """Evaluate *script* in the page context (returns JSON-serialisable value)."""
        try:
            return self._run(self._page.evaluate(script, *args))  # type: ignore[union-attr]
        except Exception as exc:  # noqa: BLE001
            logger.debug("run_js error: %s", exc)
            return None

    def run_cdp(self, method: str, **params) -> dict:
        """Send a raw CDP command (patchright CDPSession)."""
        try:
            async def _cdp():
                client = await self._page.context.new_cdp_session(self._page)  # type: ignore[union-attr]
                return await client.send(method, params)
            return self._run(_cdp()) or {}
        except Exception as exc:  # noqa: BLE001
            logger.debug("run_cdp %s error: %s", method, exc)
            return {}

    # ── Wait helpers ──────────────────────────────────────────────────────────

    class _WaitProxy:
        def __init__(self, adapter: "_ShardPageAdapter") -> None:
            self._a = adapter

        def doc_loaded(self, timeout: float = 10.0) -> None:
            self._a._run(
                self._a._page.wait_for_load_state(  # type: ignore[union-attr]
                    "domcontentloaded", timeout=int(timeout * 1000)
                )
            )

    @property
    def wait(self) -> "_WaitProxy":
        return self._WaitProxy(self)


class _ShardElementAdapter:
    """Wraps a patchright ElementHandle + Locator to look like a DrissionPage element."""

    def __init__(self, handle: object, locator: object, loop: object) -> None:
        self._handle = handle
        self._locator = locator
        self._loop = loop

    def _run(self, coro):
        import asyncio as _asyncio
        future = _asyncio.run_coroutine_threadsafe(coro, self._loop)  # type: ignore[arg-type]
        return future.result(timeout=30)

    @property
    def tag(self) -> str:
        try:
            return self._run(self._handle.get_property("tagName")).json_value().lower()  # type: ignore[union-attr]
        except Exception:
            return ""

    @property
    def text(self) -> str:
        try:
            return self._run(self._handle.inner_text())  # type: ignore[union-attr]
        except Exception:
            return ""

    def attr(self, name: str) -> Optional[str]:
        try:
            return self._run(self._handle.get_attribute(name))  # type: ignore[union-attr]
        except Exception:
            return None

    def click(self) -> None:
        self._run(self._locator.click())  # type: ignore[union-attr]

    def input(self, value: str) -> None:
        self._run(self._locator.fill(value))  # type: ignore[union-attr]

    def clear(self) -> None:
        self._run(self._locator.clear())  # type: ignore[union-attr]

    def press(self, key: str) -> None:
        self._run(self._locator.press(key))  # type: ignore[union-attr]

    def type(self, value: str) -> None:
        self._run(self._locator.type(value))  # type: ignore[union-attr]


# ── Selector translation helper ───────────────────────────────────────────────

def _shard_selector_to_locator(page: object, selector: str):
    """Translate a DrissionPage selector string to a patchright Locator."""
    s = selector.strip()

    # text=Foo  /  text:Foo
    if s.startswith("text=") or s.startswith("text:"):
        text = s.split("=", 1)[-1] if "=" in s else s.split(":", 1)[-1]
        return page.get_by_text(text, exact=False)  # type: ignore[union-attr]

    # aria:Label
    if s.startswith("aria:"):
        label = s[5:]
        return page.get_by_role("any", name=label)  # type: ignore[union-attr]

    # @attr=value  →  [attr="value"]
    if s.startswith("@"):
        part = s[1:]
        if "=" in part:
            attr, val = part.split("=", 1)
            return page.locator(f'[{attr}="{val}"]')  # type: ignore[union-attr]
        return page.locator(f"[{part}]")  # type: ignore[union-attr]

    # css:selector
    if s.startswith("css:"):
        return page.locator(s[4:])  # type: ignore[union-attr]

    # xpath://…
    if s.startswith("xpath:") or s.startswith("xpath://"):
        xpath = s.split(":", 1)[-1]
        return page.locator(f"xpath={xpath}")  # type: ignore[union-attr]

    # tag:input  →  input
    if s.startswith("tag:"):
        return page.locator(s[4:])  # type: ignore[union-attr]

    # Fallback — treat as CSS
    return page.locator(s)  # type: ignore[union-attr]
