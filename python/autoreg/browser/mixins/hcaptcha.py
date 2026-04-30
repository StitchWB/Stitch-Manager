"""Mixin for hCaptcha checkbox interaction"""
import logging
import time

logger = logging.getLogger(__name__)


class HCaptchaMixin:
    """Reusable hCaptcha checkbox methods"""

    def __init__(self):
        super().__init__()

    def _find_hcaptcha_iframe(self, page, timeout=3):
        """Find the hCaptcha iframe on the page.

        Returns: iframe element or None
        """
        try:
            iframe = page.ele('css:iframe[src*="hcaptcha"]', timeout=timeout)
            return iframe
        except Exception:
            return None

    def _click_hcaptcha_in_iframe(self, page, iframe):
        """Click hCaptcha checkbox inside the iframe using DrissionPage frame context.

        DrissionPage's get_frame() allows direct access to cross-origin iframes
        without CORS restrictions. Finds the checkbox by its ID and clicks it.

        Returns: bool - success
        """
        try:
            frame = page.get_frame(iframe)
            if not frame:
                logger.warning("Could not get DrissionPage frame context for hCaptcha iframe — will try CDP fallback")
                return False

            # The checkbox element has id="checkbox" in hCaptcha iframes
            checkbox = frame.ele('css:#checkbox', timeout=2)
            if checkbox:
                checkbox.click()
                logger.info("Clicked hCaptcha checkbox via DrissionPage frame context")
                return True

            # Fallback: try any input[type=checkbox] inside the frame
            checkbox = frame.ele('css:input[type="checkbox"]', timeout=1)
            if checkbox:
                checkbox.click()
                logger.info("Clicked hCaptcha checkbox (input fallback)")
                return True

            logger.warning("hCaptcha checkbox element not found in frame (tried #checkbox and input[type=checkbox])")
            return False
        except Exception as e:
            logger.warning(f"Failed to click hCaptcha via frame context: {e}")
            return False

    def _click_hcaptcha_cdp(self, page, iframe):
        """Click hCaptcha using CDP Input.dispatchMouseEvent as last-resort fallback.

        Uses iframe rect relative to viewport. Coordinates target the center of the
        checkbox (≈ 66×66 px at offset ~19,22 inside the iframe).

        Returns: bool - success
        """
        try:
            rect = iframe.rect if hasattr(iframe, 'rect') else None
            if not rect:
                rect = page.run_js('''
                    const iframe = document.querySelector('iframe[src*="hcaptcha"]');
                    if (!iframe) return null;
                    const r = iframe.getBoundingClientRect();
                    return {left: r.left, top: r.top, width: r.width, height: r.height};
                ''')
                if not rect:
                    return False

            # Click the checkbox area (offset ~19,22 inside 66×66 iframe)
            x = rect['left'] + 19 + 33 * 0.5
            y = rect['top'] + 22 + 33 * 0.5

            page.run_cdp('Input.dispatchMouseEvent', type='mousePressed', x=x, y=y, button='left', clickCount=1)
            time.sleep(0.1)
            page.run_cdp('Input.dispatchMouseEvent', type='mouseReleased', x=x, y=y, button='left', clickCount=1)
            logger.info("Clicked hCaptcha via CDP mouse event")
            return True
        except Exception as e:
            logger.warning(f"Failed CDP hCaptcha click: {e}")
            return False

    def click_hcaptcha(self, page) -> bool:
        """Click hCaptcha checkbox with multiple fallback methods.

        1. Find iframe
        2. DrissionPage frame context (get_frame + ele.click) ← primary
        3. CDP mouse event fallback

        Returns: True if clicked, False if hCaptcha not found
        """
        logger.info("hCaptcha detected — attempting to click checkbox")

        iframe = self._find_hcaptcha_iframe(page, timeout=2)
        if not iframe:
            logger.warning("No hCaptcha iframe found on page — cannot click")
            return False

        if self._click_hcaptcha_in_iframe(page, iframe):
            return True

        logger.info("Frame-context click failed, trying CDP fallback...")
        return self._click_hcaptcha_cdp(page, iframe)

    def is_hcaptcha_solved(self, page) -> bool:
        """Check if hCaptcha is solved by looking for h-captcha-response with value.

        Stripe renders hCaptcha in an HCaptcha-container div containing:
        - An iframe with data-hcaptcha-widget-id
        - A textarea #h-captcha-response-{widget_id} that gets filled on solve
        """
        try:
            result = page.run_js("""
                // Check HCaptcha-container textareas (Stripe hosted checkout)
                const container = document.querySelector('.HCaptcha-container');
                if (container) {
                    const ta = container.querySelector('textarea[id^="h-captcha-response"]');
                    if (ta && ta.value && ta.value.length > 0) return true;
                }
                // Check page-global h-captcha-response (older integrations)
                const global_ta = document.querySelector('[name="h-captcha-response"]');
                if (global_ta && global_ta.value && global_ta.value.length > 0) return true;
                return false;
            """)
            return bool(result)
        except Exception as e:
            logger.debug(f"is_hcaptcha_solved check failed: {e}")
            return False

    def is_hcaptcha_visible(self, page) -> bool:
        """Check if hCaptcha iframe is currently visible (challenge showing)."""
        try:
            iframe = page.ele('css:iframe[src*="hcaptcha"]', timeout=1)
            if not iframe:
                logger.debug("hCaptcha iframe not found in DOM — not visible")
                return False
            # Check if iframe has non-zero dimensions
            visible = page.run_js("""
                const iframe = document.querySelector('iframe[src*="hcaptcha"]');
                if (!iframe) return false;
                const rect = iframe.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            """)
            return bool(visible)
        except Exception as e:
            logger.debug(f"is_hcaptcha_visible check failed: {e}")
            return False