"""
PatchrightEngine — unified browser engine for registration and profile launch.

Uses patchright.sync_api with real Chrome channel for anti-detection.
Supports persistent profiles, proxy, JS anti-detection injection, human-like delays.
"""
from __future__ import annotations

import json
import logging
import os
import random
import time
from typing import Any

from patchright.sync_api import Browser, BrowserContext, Page, sync_playwright

logger = logging.getLogger(__name__)


class PatchrightEngine:
    """Browser engine using Patchright (stealth Playwright fork).

    Features:
    - Real Chrome channel (not Chromium) — better fingerprint
    - Persistent profiles (Chromium user-data-dir)
    - Automatic anti-detection JS injection
    - Proxy support
    - Human-like delays built-in
    """

    def __init__(
        self,
        headless: bool = False,
        proxy: dict[str, str] | None = None,
        profile_path: str | None = None,
        viewport: dict[str, int] | None = None,
        locale: str = "en-US",
        timezone: str | None = None,
        humanize: bool = True,
        anti_detect: bool = True,
    ):
        self.headless = headless
        self.proxy = proxy
        self.profile_path = profile_path
        self.viewport = viewport or {"width": 1920, "height": 1080}
        self.locale = locale
        self.timezone = timezone
        self.humanize = humanize
        self.anti_detect = anti_detect

        self._playwright = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self.page: Page | None = None

    # ── Lifecycle ───────────────────────────────────────────────────

    def launch(self) -> Page:
        """Launch browser and return main page.

        ALWAYS uses persistent context (user_data_dir) because some sites
        (e.g. Fireworks) detect ephemeral Playwright contexts and refuse
        to initialize form tokens. A temp directory is used when no explicit
        profile_path is provided.
        """
        logger.info("[PatchrightEngine] Launching browser...")

        self._playwright = sync_playwright().start()

        # Build launch args for stealth
        args = [
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--no-first-run",
            "--no-default-browser-check",
            "--start-maximized",
            "--lang=en-US",
            "--accept-lang=en-US,en",
        ]

        if self.headless:
            args.append("--headless=new")
            args.append("--disable-gpu")

        # Proxy
        proxy_config = None
        if self.proxy and self.proxy.get("server"):
            proxy_config = {
                "server": self.proxy["server"],
            }
            if self.proxy.get("username"):
                proxy_config["username"] = self.proxy["username"]
            if self.proxy.get("password"):
                proxy_config["password"] = self.proxy["password"]

        # ALWAYS use persistent context (user_data_dir)
        # Ephemeral contexts are detected by some sites
        if not self.profile_path:
            import tempfile
            self.profile_path = os.path.join(
                tempfile.gettempdir(),
                f"patchright_profile_{os.urandom(4).hex()}"
            )
            logger.info(f"[PatchrightEngine] Using temp profile: {self.profile_path}")

        os.makedirs(self.profile_path, exist_ok=True)
        self._context = self._playwright.chromium.launch_persistent_context(
            user_data_dir=self.profile_path,
            headless=self.headless,
            channel="chrome",
            proxy=proxy_config,
            viewport=self.viewport,
            locale=self.locale,
            timezone_id=self.timezone,
            args=args,
            java_script_enabled=True,
            bypass_csp=True,
            permissions=["clipboard-read", "clipboard-write"],
        )
        self.page = self._context.pages[0] if self._context.pages else self._context.new_page()
        logger.info(f"[PatchrightEngine] Persistent context: {self.profile_path}")

        # Inject anti-detection scripts
        if self.anti_detect:
            self._inject_anti_detection()

        return self.page

    def close(self) -> None:
        """Close browser and cleanup."""
        logger.info("[PatchrightEngine] Closing browser...")
        if self._context:
            try:
                self._context.close()
            except Exception:
                pass
            self._context = None
        if self._playwright:
            try:
                self._playwright.stop()
            except Exception:
                pass
            self._playwright = None
        self.page = None

    # ── Navigation ────────────────────────────────────────────────────

    def goto(self, url: str, wait_until: str = "domcontentloaded", timeout: float = 30.0) -> None:
        """Navigate to URL."""
        if not self.page:
            raise RuntimeError("Browser not launched")
        self.page.goto(url, wait_until=wait_until, timeout=timeout * 1000)

    def url(self) -> str:
        """Get current URL."""
        return self.page.url if self.page else ""

    def title(self) -> str:
        """Get page title."""
        return self.page.title() if self.page else ""

    # ── Elements ────────────────────────────────────────────────────

    def query_selector(self, selector: str) -> Any | None:
        """Find single element."""
        if not self.page:
            return None
        return self.page.query_selector(selector)

    def query_selector_all(self, selector: str) -> list[Any]:
        """Find all elements."""
        if not self.page:
            return []
        return self.page.query_selector_all(selector)

    def fill(self, selector: str, value: str, humanize: bool | None = None) -> None:
        """Fill input with optional human-like typing."""
        if not self.page:
            raise RuntimeError("Browser not launched")
        el = self.page.wait_for_selector(selector, timeout=10000)
        if not el:
            raise RuntimeError(f"Element not found: {selector}")

        use_humanize = humanize if humanize is not None else self.humanize
        if use_humanize and value:
            self._human_type(el, value)
        else:
            el.fill(value)

    def click(self, selector: str, timeout: float = 10.0) -> None:
        """Click element."""
        if not self.page:
            raise RuntimeError("Browser not launched")
        self.page.click(selector, timeout=timeout * 1000)

    def wait_for_selector(self, selector: str, timeout: float = 10.0, state: str = "visible") -> Any | None:
        """Wait for element."""
        if not self.page:
            return None
        try:
            return self.page.wait_for_selector(selector, timeout=timeout * 1000, state=state)
        except Exception:
            return None

    def wait_for_navigation(self, timeout: float = 30.0) -> None:
        """Wait for navigation."""
        if not self.page:
            return
        self.page.wait_for_load_state("networkidle", timeout=timeout * 1000)

    # ── JavaScript ────────────────────────────────────────────────────

    def evaluate(self, expression: str, arg: Any | None = None) -> Any:
        """Evaluate JS expression."""
        if not self.page:
            raise RuntimeError("Browser not launched")
        if arg is not None:
            return self.page.evaluate(expression, arg)
        return self.page.evaluate(expression)

    # ── Cookies / Storage ─────────────────────────────────────────────

    def get_cookies(self) -> list[dict[str, Any]]:
        """Get all cookies."""
        if not self._context:
            return []
        return self._context.cookies()

    def set_cookies(self, cookies: list[dict[str, Any]]) -> None:
        """Set cookies."""
        if not self._context:
            return
        self._context.add_cookies(cookies)

    def save_cookies(self, path: str) -> None:
        """Save cookies to JSON file."""
        cookies = self.get_cookies()
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cookies, f, ensure_ascii=False, indent=2)

    def load_cookies(self, path: str) -> None:
        """Load cookies from JSON file."""
        if not os.path.exists(path):
            return
        with open(path, encoding="utf-8") as f:
            cookies = json.load(f)
        self.set_cookies(cookies)

    # ── Anti-detection ────────────────────────────────────────────────

    def _inject_anti_detection(self) -> None:
        """Inject JS to hide automation signals."""
        if not self.page:
            return

        scripts = [
            # navigator.webdriver
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})",
            # chrome.runtime
            "window.chrome = { runtime: {} }",
            # Permissions
            """
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ||
                parameters.name === 'clipboard-read' ||
                parameters.name === 'clipboard-write'
                    ? Promise.resolve({ state: Notification.permission })
                    : originalQuery(parameters)
            );
            """,
            # Plugins
            """
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });
            Object.defineProperty(navigator, 'mimeTypes', {
                get: () => [1, 2, 3, 4, 5]
            });
            """,
            # WebGL vendor/renderer
            """
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) return 'Intel Inc.';
                if (parameter === 37446) return 'Intel Iris OpenGL Engine';
                return getParameter(parameter);
            };
            """,
            # Notification permission
            """
            const originalNotification = window.Notification;
            Object.defineProperty(window, 'Notification', {
                get: function() {
                    if (arguments.length > 0 && arguments[0] === 'permission') {
                        return 'default';
                    }
                    return originalNotification;
                }
            });
            """,
        ]

        for script in scripts:
            try:
                self.page.add_init_script(script)
            except Exception as e:
                logger.debug(f"Anti-detection script injection failed: {e}")

        logger.info("[PatchrightEngine] Anti-detection scripts injected")

    # ── Human behavior ────────────────────────────────────────────────

    def _human_type(self, element: Any, text: str) -> None:
        """Type text with human-like delays and occasional mistakes."""
        for char in text:
            delay = random.uniform(0.05, 0.15)
            # Occasional typo (1% chance)
            if random.random() < 0.01 and char.isalpha():
                typo = random.choice("abcdefghijklmnopqrstuvwxyz")
                element.type(typo, delay=0)
                time.sleep(random.uniform(0.05, 0.1))
                element.press("Backspace")
                time.sleep(random.uniform(0.05, 0.1))
            element.type(char, delay=0)
            time.sleep(delay)

    def human_delay(self, min_sec: float = 0.5, max_sec: float = 1.5) -> None:
        """Sleep for random duration."""
        time.sleep(random.uniform(min_sec, max_sec))

    # ── Screenshots ───────────────────────────────────────────────────

    def screenshot(self, path: str | None = None) -> bytes | None:
        """Take screenshot."""
        if not self.page:
            return None
        if path:
            self.page.screenshot(path=path, full_page=False)
            return None
        return self.page.screenshot(full_page=False)

    # ── Context manager ───────────────────────────────────────────────

    def __enter__(self) -> PatchrightEngine:
        self.launch()
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


__all__ = ["PatchrightEngine"]
