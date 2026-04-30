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
        """Click hCaptcha checkbox inside the iframe using JS.

        Returns: bool - success
        """
        try:
            page.run_js('''
                const iframe = document.querySelector('iframe[src*="hcaptcha"]');
                if (!iframe) return false;
                const rect = iframe.getBoundingClientRect();
                const x = rect.left + rect.width * 0.4;
                const y = rect.top + rect.height * 0.55;
                const clickEvent = new MouseEvent('click', {
                    bubbles: true, cancelable: true,
                    clientX: x, clientY: y
                });
                iframe.contentDocument?.dispatchEvent(clickEvent);
                return true;
            ''')
            logger.info("Clicked hCaptcha checkbox via JS in iframe")
            return True
        except Exception as e:
            logger.warning(f"Failed to click hCaptcha in iframe: {e}")
            return False

    def _click_hcaptcha_cdp(self, page, iframe):
        """Click hCaptcha using CDP Input.dispatchMouseEvent as fallback.

        Returns: bool - success
        """
        try:
            rect = iframe.rect if hasattr(iframe, 'rect') else None
            if not rect:
                rect = page.run_js('''
                    const iframe = document.querySelector('iframe[src*="hcaptcha"]');
                    if (!iframe) return null;
                    const r = iframe.getBoundingClientRect();
                    return {x: r.x, y: r.y, width: r.width, height: r.height};
                ''')
                if not rect:
                    return False

            x = rect['x'] + rect['width'] * 0.4
            y = rect['y'] + rect['height'] * 0.55

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
        2. JS click inside iframe
        3. CDP mouse event fallback

        Returns: True if clicked, False if hCaptcha not found
        """
        logger.info("hCaptcha detected — attempting to click checkbox")

        iframe = self._find_hcaptcha_iframe(page, timeout=2)
        if not iframe:
            logger.debug("No hCaptcha iframe found on page")
            return False

        if self._click_hcaptcha_in_iframe(page, iframe):
            return True

        logger.info("JS click failed, trying CDP fallback...")
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
        except Exception:
            return False

    def is_hcaptcha_visible(self, page) -> bool:
        """Check if hCaptcha iframe is currently visible (challenge showing)."""
        try:
            iframe = page.ele('css:iframe[src*="hcaptcha"]', timeout=1)
            if not iframe:
                return False
            # Check if iframe has non-zero dimensions
            visible = page.run_js("""
                const iframe = document.querySelector('iframe[src*="hcaptcha"]');
                if (!iframe) return false;
                const rect = iframe.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            """)
            return bool(visible)
        except Exception:
            return False