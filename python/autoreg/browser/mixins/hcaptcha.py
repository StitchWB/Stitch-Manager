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

        Tries multiple selectors because hCaptcha may use different iframe patterns
        (direct iframe, inside HCaptcha-container div, etc.).
        Returns: iframe element or None
        """
        selectors = [
            'css:.HCaptcha-container iframe',
            'css:iframe[src*="hcaptcha"]',
            'css:iframe[src*="hcaptcha.com"]',
            'css:iframe[data-hcaptcha-widget-id]',
            'css:iframe[title*="hCaptcha"]',
            'css:iframe[id*="hcaptcha"]',
        ]
        for sel in selectors:
            try:
                iframe = page.ele(sel, timeout=timeout)
                if iframe:
                    logger.info(f"Found hCaptcha iframe with selector: {sel}")
                    return iframe
            except Exception:
                continue
        
        # Final fallback: search all iframes for hcaptcha in src
        try:
            iframes = page.eles('css:iframe')
            for iframe in iframes:
                try:
                    src = iframe.attr('src') or ''
                    if 'hcaptcha' in src.lower():
                        logger.info(f"Found hCaptcha iframe by src scan: {src[:80]}")
                        return iframe
                except Exception:
                    continue
        except Exception:
            pass
        
        return None

    def _click_hcaptcha_in_iframe(self, page, iframe):
        """Click hCaptcha checkbox inside the iframe using multiple strategies.

        Strategy 1: DrissionPage frame context (get_frame + ele.click)
        Strategy 2: JavaScript injection via contentWindow (bypasses CORS)
        Strategy 3: JavaScript click on the iframe element itself

        Retries up to 10 times (1s apart) because hCaptcha renders asynchronously.

        Returns: bool - success
        """
        # --- Strategy 1: DrissionPage frame context ---
        try:
            frame = page.get_frame(iframe)
            if frame:
                for attempt in range(6):
                    checkbox = frame.ele('css:#checkbox', timeout=2)
                    if not checkbox:
                        checkbox = frame.ele('css:input[type="checkbox"]', timeout=1)
                    if not checkbox:
                        checkbox = frame.ele('css:.h-captcha-checkbox', timeout=1)
                    if not checkbox:
                        checkbox = frame.ele('css:[id*="checkbox"]', timeout=1)
                    if not checkbox:
                        checkbox = frame.ele('css:.checkbox', timeout=1)

                    if checkbox:
                        checkbox.click()
                        logger.info(
                            f"Clicked hCaptcha checkbox via DrissionPage frame (attempt {attempt + 1})"
                        )
                        return True

                    if attempt < 5:
                        logger.debug(f"hCaptcha checkbox not in frame yet (attempt {attempt + 1}/6)")
                        time.sleep(1.0)
        except Exception as e:
            logger.debug(f"DrissionPage frame context failed: {e}")

        # --- Strategy 2: JavaScript via contentWindow ---
        try:
            logger.info("Trying JS contentWindow strategy for hCaptcha")
            result = page.run_js("""
                const iframe = document.querySelector('iframe[src*="hcaptcha"], iframe[data-hcaptcha-widget-id], .HCaptcha-container iframe');
                if (!iframe) return { success: false, error: 'iframe not found' };
                
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (!iframeDoc) return { success: false, error: 'cannot access iframe document' };
                    
                    // Try multiple checkbox selectors
                    const selectors = [
                        '#checkbox',
                        'input[type="checkbox"]',
                        '.h-captcha-checkbox',
                        '[id*="checkbox"]',
                        '.checkbox',
                        'div[role="checkbox"]',
                        '.check'
                    ];
                    
                    for (const sel of selectors) {
                        const el = iframeDoc.querySelector(sel);
                        if (el) {
                            el.click();
                            return { success: true, selector: sel, method: 'contentWindow' };
                        }
                    }
                    
                    // If no specific checkbox found, try clicking the body center
                    // (hCaptcha sometimes uses a single clickable div)
                    const body = iframeDoc.body;
                    if (body) {
                        const rect = body.getBoundingClientRect();
                        const clickEvent = new MouseEvent('click', {
                            bubbles: true,
                            cancelable: true,
                            clientX: rect.width / 2,
                            clientY: rect.height / 2
                        });
                        body.dispatchEvent(clickEvent);
                        return { success: true, method: 'body_click' };
                    }
                    
                    return { success: false, error: 'no clickable element found in iframe' };
                } catch (e) {
                    return { success: false, error: e.message };
                }
            """)
            
            if isinstance(result, dict) and result.get('success'):
                logger.info(f"Clicked hCaptcha via JS contentWindow: {result.get('method')}")
                return True
            else:
                logger.debug(f"JS contentWindow failed: {result}")
        except Exception as e:
            logger.debug(f"JS contentWindow strategy error: {e}")

        # --- Strategy 3: Click the iframe element itself (triggers hCaptcha) ---
        try:
            logger.info("Trying direct iframe click strategy")
            iframe.click()
            logger.info("Clicked hCaptcha iframe element directly")
            return True
        except Exception as e:
            logger.debug(f"Direct iframe click failed: {e}")

        logger.warning(
            "All hCaptcha click strategies failed "
            "(tried DrissionPage frame, JS contentWindow, direct iframe click)"
        )
        return False

    def _click_hcaptcha_cdp(self, page, iframe):
        """Click hCaptcha using CDP Input.dispatchMouseEvent as last-resort fallback.

        Uses iframe rect relative to viewport. Coordinates target the center of the
        checkbox area inside the iframe.

        Returns: bool - success
        """
        try:
            rect = iframe.rect if hasattr(iframe, 'rect') else None
            if not rect:
                rect = page.run_js('''
                    const iframe = document.querySelector('iframe[src*="hcaptcha"], iframe[data-hcaptcha-widget-id], .HCaptcha-container iframe');
                    if (!iframe) return null;
                    const r = iframe.getBoundingClientRect();
                    return {left: r.left, top: r.top, width: r.width, height: r.height};
                ''')
                if not rect:
                    return False

            # hCaptcha checkbox iframe is typically 66x66 or 303x78 px
            # The checkbox itself is in the top-left area, ~30x30 px
            # Click at 1/3 from left, 1/3 from top (conservative checkbox area)
            x = rect['left'] + min(rect['width'] * 0.25, 20)
            y = rect['top'] + min(rect['height'] * 0.35, 25)

            page.run_cdp('Input.dispatchMouseEvent', type='mousePressed', x=x, y=y, button='left', clickCount=1)
            time.sleep(0.1)
            page.run_cdp('Input.dispatchMouseEvent', type='mouseReleased', x=x, y=y, button='left', clickCount=1)
            logger.info(f"Clicked hCaptcha via CDP at ({x:.1f}, {y:.1f})")
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