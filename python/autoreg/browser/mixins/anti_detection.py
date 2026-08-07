"""
Anti-detection mixin for browser automation.

Provides methods to avoid detection by anti-bot systems like AWS FWCIM.
"""

import logging
import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from DrissionPage import ChromiumPage

from autoreg.spoofers.cdp_spoofer import CDPSpoofer, apply_pre_navigation_spoofing
from autoreg.spoofers.profile_storage import ProfileStorage

logger = logging.getLogger(__name__)


class AntiDetectionMixin:
    """Mixin providing anti-detection capabilities for browser automation."""

    def apply_anti_detection(
        self,
        page: "ChromiumPage",
        email: str | None = None,
        profile_storage_dir: str | None = None,
    ) -> CDPSpoofer | None:
        """
        Apply anti-fingerprinting spoofing to the browser.

        Args:
            page: ChromiumPage instance
            email: Email for consistent fingerprint profile
            profile_storage_dir: Directory to store/load profiles

        Returns:
            CDPSpoofer instance if successful, None otherwise
        """
        # Check if spoofing is enabled
        spoofing_enabled = os.environ.get("SPOOFING_ENABLED", "1") == "1"

        if not spoofing_enabled:
            logger.info("Spoofing disabled by settings")
            return None

        try:
            # Use ProfileStorage for consistent fingerprint
            profile = None
            if email and profile_storage_dir:
                storage = ProfileStorage(profile_storage_dir)
                profile = storage.get_or_create(email)
                logger.info(f"Loaded/created profile for {email}")

            spoofer = apply_pre_navigation_spoofing(page, profile)
            logger.info("Anti-fingerprint spoofing applied")
            return spoofer

        except (RuntimeError, ImportError) as e:
            logger.warning(f"Spoofing failed: {e}")
            return None

    def _inject_navigator_overrides(self, page: "ChromiumPage") -> None:
        """
        Inject navigator property overrides to hide automation.

        Args:
            page: ChromiumPage instance
        """
        try:
            page.run_js("""
                // Override navigator.webdriver
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });

                // Override navigator.plugins
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });

                // Override navigator.languages
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en']
                });

                // Override chrome runtime
                window.chrome = {
                    runtime: {}
                };

                // Override permissions
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ?
                        Promise.resolve({ state: Notification.permission }) :
                        originalQuery(parameters)
                );
            """)
            logger.debug("Navigator overrides injected")
        except RuntimeError as e:
            logger.warning(f"Failed to inject navigator overrides: {e}")

    def _inject_webgl_spoofing(self, page: "ChromiumPage") -> None:
        """
        Inject WebGL spoofing to randomize fingerprint.

        Args:
            page: ChromiumPage instance
        """
        try:
            page.run_js("""
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(parameter) {
                    // Randomize UNMASKED_VENDOR_WEBGL
                    if (parameter === 37445) {
                        return 'Intel Inc.';
                    }
                    // Randomize UNMASKED_RENDERER_WEBGL
                    if (parameter === 37446) {
                        return 'Intel Iris OpenGL Engine';
                    }
                    return getParameter.call(this, parameter);
                };
            """)
            logger.debug("WebGL spoofing injected")
        except RuntimeError as e:
            logger.warning(f"Failed to inject WebGL spoofing: {e}")

    def _inject_canvas_protection(self, page: "ChromiumPage") -> None:
        """
        Inject canvas fingerprint protection.

        Args:
            page: ChromiumPage instance
        """
        try:
            page.run_js("""
                const toBlob = HTMLCanvasElement.prototype.toBlob;
                const toDataURL = HTMLCanvasElement.prototype.toDataURL;
                const getImageData = CanvasRenderingContext2D.prototype.getImageData;

                // Add noise to canvas
                const noisify = function(canvas, context) {
                    const shift = {
                        'r': Math.floor(Math.random() * 10) - 5,
                        'g': Math.floor(Math.random() * 10) - 5,
                        'b': Math.floor(Math.random() * 10) - 5,
                        'a': Math.floor(Math.random() * 10) - 5
                    };

                    const width = canvas.width;
                    const height = canvas.height;
                    const imageData = getImageData.apply(context, [0, 0, width, height]);
                    for (let i = 0; i < height; i++) {
                        for (let j = 0; j < width; j++) {
                            const n = ((i * (width * 4)) + (j * 4));
                            imageData.data[n + 0] = imageData.data[n + 0] + shift.r;
                            imageData.data[n + 1] = imageData.data[n + 1] + shift.g;
                            imageData.data[n + 2] = imageData.data[n + 2] + shift.b;
                            imageData.data[n + 3] = imageData.data[n + 3] + shift.a;
                        }
                    }
                    context.putImageData(imageData, 0, 0);
                };

                Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
                    value: function() {
                        noisify(this, this.getContext('2d'));
                        return toBlob.apply(this, arguments);
                    }
                });

                Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
                    value: function() {
                        noisify(this, this.getContext('2d'));
                        return toDataURL.apply(this, arguments);
                    }
                });
            """)
            logger.debug("Canvas protection injected")
        except RuntimeError as e:
            logger.warning(f"Failed to inject canvas protection: {e}")

    def _apply_cdp_spoofing(self, page: "ChromiumPage") -> None:
        """
        Apply Chrome DevTools Protocol spoofing.

        Args:
            page: ChromiumPage instance
        """
        try:
            # Spoof user agent
            page.run_cdp(
                "Network.setUserAgentOverride",
                userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )

            # Spoof platform
            page.run_cdp(
                "Emulation.setUserAgentOverride",
                userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                platform="Win32",
            )

            logger.debug("CDP spoofing applied")
        except RuntimeError as e:
            logger.warning(f"Failed to apply CDP spoofing: {e}")

    def _load_or_create_profile(
        self, email: str, profile_storage_dir: str
    ) -> dict | None:
        """
        Load existing profile or create new one for consistent fingerprinting.

        Args:
            email: Email identifier for profile
            profile_storage_dir: Directory to store profiles

        Returns:
            Profile dict or None
        """
        try:
            storage = ProfileStorage(profile_storage_dir)
            profile = storage.get_or_create(email)
            logger.info(f"Profile loaded/created for {email}")
            return profile
        except Exception as e:
            logger.error(f"Failed to load/create profile: {e}")
            return None
