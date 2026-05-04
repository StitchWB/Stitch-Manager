"""Mixin for hCaptcha checkbox interaction"""
import logging
import os
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
                    if not checkbox:
                        # hCaptcha v2+ sometimes uses a div with role or aria-checkbox
                        checkbox = frame.ele('css:div[role="checkbox"], css:div[aria-checked]', timeout=1)
                    if not checkbox:
                        # Try clicking the frame's body as last resort
                        try:
                            body = frame.ele('css:body', timeout=1)
                            if body:
                                body.click()
                                logger.info("Clicked hCaptcha frame body via DrissionPage")
                                return True
                        except Exception:
                            pass

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
            # ChromiumFrame objects don't have .click() — use page.run_js instead
            try:
                iframe.click()
            except AttributeError:
                page.run_js("arguments[0].click();", iframe)
            logger.info("Clicked hCaptcha iframe element directly")
            return True
        except Exception as e:
            logger.debug(f"Direct iframe click failed: {e}")

        logger.warning(
            "All hCaptcha click strategies failed "
            "(tried DrissionPage frame, JS contentWindow, direct iframe click)"
        )
        return False

    def _click_hcaptcha_via_cdp_eval(self, page, iframe) -> bool:
        """Click hCaptcha checkbox using CDP Runtime.evaluate inside the iframe context.

        This uses CDP's execution context system to run JavaScript INSIDE the
        cross-origin iframe, completely bypassing CORS restrictions. Much more
        reliable than DrissionPage frame context or contentWindow injection.

        Returns: bool - success
        """
        try:
            # 1. Get all execution contexts from CDP
            contexts_result = page.run_cdp('Runtime.getExecutionContexts')
            contexts = contexts_result.get('contexts', []) if isinstance(contexts_result, dict) else []
            
            logger.debug(f"CDP contexts found: {len(contexts)}")
            for ctx in contexts:
                name = ctx.get('name', '')
                origin = ctx.get('origin', '')
                logger.debug(f"  CDP ctx: name={name[:60]}, origin={origin[:60]}, id={ctx.get('id', '?')[:12]}")
            
            # 2. Find the context for the hCaptcha iframe
            # The iframe name/source helps identify it
            hcaptcha_ctx = None
            for ctx in contexts:
                name = ctx.get('name', '')
                origin = ctx.get('origin', '')
                frame_id = ctx.get('auxData', {}).get('frameId', '') if isinstance(ctx.get('auxData'), dict) else ''
                if 'hcaptcha' in name.lower() or 'hcaptcha' in origin.lower():
                    hcaptcha_ctx = ctx['id']
                    logger.info(f"Found hCaptcha CDP context: {name} (frame: {frame_id})")
                    break
            
            if not hcaptcha_ctx:
                # Fallback: try to match by iframe name pattern
                try:
                    iframe_name = page.run_js("""
                        const f = document.querySelector('iframe[src*="hcaptcha"]');
                        return f ? f.name : null;
                    """)
                    if iframe_name:
                        for ctx in contexts:
                            if ctx.get('name', '') == iframe_name:
                                hcaptcha_ctx = ctx['id']
                                break
                except Exception:
                    pass
            
            if not hcaptcha_ctx:
                logger.debug("Could not find hCaptcha execution context via CDP")
                return False
            
            # 3. Evaluate JS inside the iframe to find and click the checkbox
            for attempt in range(6):
                result = page.run_cdp('Runtime.evaluate', **{
                    'expression': '''
                        (function() {
                            const selectors = [
                                '#checkbox',
                                'input[type="checkbox"]',
                                '.h-captcha-checkbox',
                                '[id*="checkbox"]',
                                '.checkbox',
                                'div[role="checkbox"]',
                                'div[aria-checked]',
                                '.check'
                            ];
                            for (const sel of selectors) {
                                const el = document.querySelector(sel);
                                if (el) {
                                    el.click();
                                    return {success: true, selector: sel};
                                }
                            }
                            return {success: false, error: 'no checkbox in iframe'};
                        })()
                    ''',
                    'contextId': hcaptcha_ctx,
                    'returnByValue': True,
                })
                
                if isinstance(result, dict):
                    value = result.get('result', {}).get('value') if isinstance(result.get('result'), dict) else result.get('value')
                    if isinstance(value, dict) and value.get('success'):
                        logger.info(f"Clicked hCaptcha via CDP eval: {value.get('selector')} (attempt {attempt + 1})")
                        return True
                
                if attempt < 5:
                    logger.debug(f"hCaptcha CDP eval not ready (attempt {attempt + 1}/6)")
                    time.sleep(1.0)
            
            logger.warning("hCaptcha checkbox not found via CDP eval after 6 attempts")
            return False
        except Exception as e:
            logger.debug(f"CDP Runtime.evaluate failed: {e}")
            if os.environ.get("AUTOREG_DEBUG", "").lower() in ("1", "true", "yes"):
                import traceback
                logger.debug(f"CDP eval traceback: {traceback.format_exc()}")
            return False

    def _click_hcaptcha_cdp(self, page, iframe):
        """Click hCaptcha using CDP Input.dispatchMouseEvent as last-resort fallback.

        Uses iframe rect relative to viewport. Coordinates target the center of the
        checkbox area inside the iframe.

        Returns: bool - success
        """
        try:
            rect = iframe.rect if hasattr(iframe, 'rect') else None
            
            # Extract coordinates — rect may be a FrameRect object (attributes)
            # or a dict from JS getBoundingClientRect
            if rect is not None:
                try:
                    # FrameRect / ChromiumRect — use direct attribute access
                    left = rect.left
                    top = rect.top
                    width = rect.width
                    height = rect.height
                except (AttributeError, TypeError):
                    try:
                        # Might be a dict from JS getBoundingClientRect
                        left = rect['left']
                        top = rect['top']
                        width = rect['width']
                        height = rect['height']
                    except (KeyError, TypeError):
                        rect = None
            else:
                # Fallback: get rect via JS
                js_rect = page.run_js('''
                    const iframe = document.querySelector('iframe[src*="hcaptcha"], iframe[data-hcaptcha-widget-id], .HCaptcha-container iframe');
                    if (!iframe) return null;
                    const r = iframe.getBoundingClientRect();
                    return {left: r.left, top: r.top, width: r.width, height: r.height};
                ''')
                if not js_rect or not isinstance(js_rect, dict):
                    return False
                left, top, width, height = js_rect['left'], js_rect['top'], js_rect['width'], js_rect['height']

            # Try multiple click positions — checkbox may be at different spots
            # depending on hCaptcha version and layout
            positions = [
                (width * 0.25, height * 0.35),   # top-left area (classic 66x66 iframe)
                (width * 0.15, height * 0.30),   # more aggressive top-left
                (width * 0.50, height * 0.40),   # center (full-page overlay)
                (width * 0.50, height * 0.50),   # dead center
                (width * 0.35, height * 0.45),   # alternative center
            ]
            
            clicked = False
            for px, py in positions:
                x = left + px
                y = top + py
                try:
                    page.run_cdp('Input.dispatchMouseEvent', type='mousePressed', x=x, y=y, button='left', clickCount=1)
                    time.sleep(0.05)
                    page.run_cdp('Input.dispatchMouseEvent', type='mouseReleased', x=x, y=y, button='left', clickCount=1)
                    clicked = True
                    logger.info(f"Clicked hCaptcha via CDP at ({x:.0f}, {y:.0f}) — ({px/width*100:.0f}%, {py/height*100:.0f}%)")
                    break
                except Exception:
                    continue
            
            if not clicked:
                logger.warning("All CDP click positions failed")
                return False
            
            return True
        except Exception as e:
            logger.warning(f"Failed CDP hCaptcha click: {e}")
            return False

    def click_hcaptcha(self, page) -> bool:
        """Click hCaptcha checkbox with multiple fallback methods.

        Strategy priority (most reliable first):
        1. CDP Runtime.evaluate inside frame context (bypasses CORS)
        2. CDP Input.dispatchMouseEvent at checkbox coordinates
        3. DrissionPage frame context + JS contentWindow + direct click

        Returns: True if clicked, False if hCaptcha not found
        """
        logger.info("hCaptcha detected — attempting to click checkbox")

        iframe = self._find_hcaptcha_iframe(page, timeout=2)
        if not iframe:
            logger.warning("No hCaptcha iframe found on page — cannot click")
            return False

        # Primary: CDP Runtime.evaluate (JS inside iframe, no CORS)
        if self._click_hcaptcha_via_cdp_eval(page, iframe):
            return True

        # Secondary: CDP mouse event at calculated coordinates
        logger.info("CDP eval failed, trying CDP mouse event...")
        if self._click_hcaptcha_cdp(page, iframe):
            return True

        # Tertiary: DrissionPage frame-based strategies
        logger.info("CDP mouse event failed, trying frame-context strategies...")
        return self._click_hcaptcha_in_iframe(page, iframe)

    def is_hcaptcha_solved(self, page) -> bool:
        """Check if hCaptcha is solved by looking for h-captcha-response with value.

        Stripe renders hCaptcha in two ways:
        - HCaptcha-container div (older Stripe integrations)
        - data-react-aria-top-layer overlay (newer Stripe)
        """
        try:
            result = page.run_js("""
                // Check HCaptcha-container textareas (Stripe hosted checkout)
                const container = document.querySelector('.HCaptcha-container');
                if (container) {
                    const ta = container.querySelector('textarea[id^="h-captcha-response"]');
                    if (ta && ta.value && ta.value.length > 0) return true;
                }
                // Check top-level overlay (newer Stripe: data-react-aria-top-layer)
                const overlay = document.querySelector('[data-react-aria-top-layer]');
                if (overlay) {
                    const ta = overlay.querySelector('textarea[id^="h-captcha-response"]');
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