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


class BaseBrowser:
    """
    Base class for browser automation with DrissionPage.
    
    Provides common functionality for:
    - Browser initialization with ChromiumOptions
    - Chrome executable path detection
    - User data directory management
    - Cookie and storage clearing
    - Window management
    - Clean shutdown
    
    Attributes:
        page: ChromiumPage instance for browser automation
        headless: Whether browser runs in headless mode
        
    Example:
        ```python
        browser = BaseBrowser(headless=True, clear_cookies=True)
        browser.navigate("https://example.com")
        print(browser.current_url)
        browser.close()
        ```
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
            proxy_url: Proxy URL (host:port)
            proxy_username: Proxy username
            proxy_password: Proxy password
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

        # Attempt auto-download on first run (Windows only)
        if system == "Windows" and os.environ.get("AUTOREG_AUTO_DOWNLOAD_CLOAKBROWSER", "1") == "1":
            download_script = project_root / "python" / "autoreg" / "browser" / "download_cloakbrowser.py"
            if download_script.exists():
                logger.info("CloakBrowser not found — attempting auto-download...")
                try:
                    result = subprocess.run(
                        [sys.executable, str(download_script)],
                        capture_output=True, text=True, timeout=600,
                    )
                    downloaded = project_root / "resources" / "cloakbrowser" / "chrome.exe"
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
        Initialize ChromiumPage with configured options.
        
        This method:
        1. Sets up ChromiumOptions
        2. Creates ChromiumPage instance
        3. Waits for CDP connection
        4. Maximizes window (non-headless)
        5. Clears cookies/storage (if clear_cookies=True)
        
        Raises:
            RuntimeError: If browser initialization or CDP connection fails
        """
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
                logger.info("Cookies and storage cleared")
            except RuntimeError as e:
                logger.warning(f"Failed to clear cookies: {e}")
    
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
        
        This method:
        1. Quits ChromiumPage
        2. Deletes temporary profile directory (if created)
        
        Safe to call multiple times.
        """
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
