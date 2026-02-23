"""
Cookie handling mixin for browser automation.

Provides methods to handle cookie banners and dialogs.
"""

import logging
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from DrissionPage import ChromiumPage

logger = logging.getLogger(__name__)


class CookieHandlingMixin:
    """Mixin providing cookie banner handling for browser automation."""

    def __init__(self):
        """Initialize cookie handling state."""
        self._cookie_closed = False

    def close_cookie_dialog(self, page: "ChromiumPage", force: bool = False) -> bool:
        """
        Accept or hide cookie dialog.

        Args:
            page: ChromiumPage instance
            force: Force closing even if already closed

        Returns:
            True if dialog was handled
        """
        if self._cookie_closed and not force:
            return False

        # Try to accept first (cleaner)
        if self._accept_cookie_banner(page):
            self._cookie_closed = True
            return True

        # Fallback: hide via CSS
        self._hide_cookie_banner(page)
        self._cookie_closed = True
        return True

    def _accept_cookie_banner(self, page: "ChromiumPage") -> bool:
        """
        Accept cookie banner by clicking Accept button.

        Args:
            page: ChromiumPage instance

        Returns:
            True if banner was accepted
        """
        try:
            from DrissionPage.errors import ContextLostError
        except ImportError:
            ContextLostError = RuntimeError

        for attempt in range(3):
            try:
                # Try DrissionPage element finding
                try:
                    accept_btn = page.ele("text=Accept", timeout=0.5)
                    if accept_btn and accept_btn.tag == "button":
                        accept_btn.click()
                        logger.info("Cookie banner accepted (DrissionPage)")
                        return True
                except (RuntimeError, TimeoutError):
                    pass

                # Try JavaScript approach
                try:
                    result = page.run_js("""
                        const acceptButtons = [
                            '[data-id="awsccc-cb-btn-accept"]',
                            'button[data-id*="accept"]',
                            '#awsccc-cb-btn-accept',
                        ];
                        for (const sel of acceptButtons) {
                            try {
                                const btn = document.querySelector(sel);
                                if (btn && btn.offsetParent !== null) {
                                    btn.click();
                                    return 'clicked';
                                }
                            } catch(e) {}
                        }
                        const allButtons = document.querySelectorAll('button');
                        for (const btn of allButtons) {
                            const text = btn.textContent.trim();
                            if ((text === 'Accept' || text === 'Принять') && btn.offsetParent !== null) {
                                btn.click();
                                return 'clicked';
                            }
                        }
                        return 'not_found';
                    """)
                    if result == "clicked":
                        logger.info("Cookie banner accepted (JS)")
                        return True
                except RuntimeError:
                    pass

                return False

            except ContextLostError:
                if attempt < 2:
                    logger.debug(
                        f"Page navigated during cookie check, waiting... (attempt {attempt + 1}/3)"
                    )
                    try:
                        page.wait.doc_loaded(timeout=5)
                    except Exception:
                        time.sleep(1)
                    continue
                else:
                    logger.warning("Cookie banner check failed after navigation")
                    return False

        return False

    def _hide_cookie_banner(self, page: "ChromiumPage") -> None:
        """
        Hide cookie banner using CSS.

        Args:
            page: ChromiumPage instance
        """
        try:
            page.run_js("""
                const selectors = [
                    '#awsccc-cb-content',
                    '#awsccc-cb',
                    '.awsccc-cs-overlay',
                    '.awscc-cookie-banner',
                    '.awsccc-cb-container'
                ];
                selectors.forEach(sel => {
                    const el = document.querySelector(sel);
                    if (el) el.style.display = 'none';
                });
                document.querySelectorAll('.awsccc-cs-overlay, .modal-backdrop').forEach(el => el.remove());
            """)
            logger.debug("Cookie banner hidden via CSS")
        except RuntimeError as e:
            logger.warning(f"Failed to hide cookie banner: {e}")

    def _detect_cookie_banner(self, page: "ChromiumPage") -> bool:
        """
        Detect if cookie banner is present.

        Args:
            page: ChromiumPage instance

        Returns:
            True if banner detected
        """
        selectors = [
            "#awsccc-cb-content",
            "#awsccc-cb",
            ".awsccc-cs-overlay",
            "text=Accept",
            "text=Принять",
        ]

        for selector in selectors:
            try:
                if page.ele(selector, timeout=0.3):
                    return True
            except (RuntimeError, TimeoutError):
                pass

        return False

    def reset_cookie_state(self) -> None:
        """Reset cookie handling state."""
        self._cookie_closed = False
        logger.debug("Cookie state reset")
