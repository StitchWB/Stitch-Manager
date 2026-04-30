"""Mixin for Stripe checkout iframe handling"""
import logging
from typing import Any
from DrissionPage import ChromiumPage

logger = logging.getLogger(__name__)


class StripeIframeMixin:
    """Reusable Stripe payment iframe methods for provider browsers"""
    
    def find_stripe_iframe(self, page: ChromiumPage, iframe_type: str = "payment", timeout: float = 10):
        """Find Stripe iframe by type (payment vs address).
        
        Args:
            page: DrissionPage ChromiumPage
            iframe_type: "payment" or "address" to filter by src keyword
            timeout: Timeout per iframe check
            
        Returns:
            iframe element or None
        """
        keyword = "payment" if iframe_type == "payment" else "address"
        for attempt in range(int(timeout * 2)):
            iframes = page.eles("tag:iframe", timeout=1)
            for iframe in iframes:
                src = iframe.attr("src") or ""
                if "stripe.com" in src and keyword in src:
                    logger.info(f"Found Stripe {iframe_type} iframe")
                    return iframe
            self.human_delay(0.3, 0.5) if hasattr(self, 'human_delay') else __import__('time').sleep(0.5)
        return None
    
    def _try_fill_field(self, page_or_frame, field_variants: list[str], value: str, label: str, timeout: float = 0.5) -> Any:
        """Try to find and return a field element using multiple selector variants.

        Searches for both <input> and <select> elements (e.g. state/country dropdowns).
        Returns the field element if found, None otherwise.
        """
        field = None
        for variant in field_variants:
            # Try <input> first (most fields)
            selectors = [
                f'css:input[name="{variant}"]',
                f'css:input#{variant}',
                f'css:input[placeholder*="{variant}"]',
                f'css:input[aria-label*="{variant}"]',
                # Also try <select> (dropdowns like state/country)
                f'css:select[name="{variant}"]',
                f'css:select#{variant}',
                f'css:select[aria-label*="{variant}"]',
            ]
            for sel in selectors:
                try:
                    field = page_or_frame.ele(sel, timeout=timeout)
                    if field:
                        return field
                except Exception:
                    pass
        return None

    def fill_stripe_field(self, page, field_variants: list[str], value: str, label: str = "Field", timeout: float = 0.5, iframe=None):
        """Fill a Stripe field with page-first, iframe-fallback strategy.

        Stripe checkout may render fields either:
        1. Directly in the page DOM (hosted checkout, direct embedding)
        2. Inside a Stripe iframe (Elements iframe, some integrations)

        This method first tries to find the field directly on the page.
        Only if not found does it fall back to the iframe (if provided).

        Args:
            page: ChromiumPage
            field_variants: List of possible field name attributes (e.g. ['cardNumber', 'number'])
            value: Value to fill
            label: Log label for this field
            timeout: Timeout per selector attempt
            iframe: Optional iframe element to search inside if page search fails

        Returns:
            bool: success
        """
        if not value:
            return False

        # Strategy 1: Find field directly on the page (most common for hosted checkout)
        field = self._try_fill_field(page, field_variants, value, label, timeout)
        source = "page"

        # Strategy 2: Fallback to iframe if provided and not found on page
        if not field and iframe:
            frame = page.get_frame(iframe)
            if frame:
                field = self._try_fill_field(frame, field_variants, value, label, timeout)
                source = "iframe"

        if field:
            try:
                field.click()
                self.human_delay(0.05, 0.1) if hasattr(self, 'human_delay') else __import__('time').sleep(0.1)
                # Handle <select> dropdowns (e.g. state/country) differently from <input>
                tag = getattr(field, 'tag', None) or getattr(field, 'tag_name', None)
                if tag and tag.lower() == 'select':
                    # Use JavaScript to set select value — more reliable than .select()
                    page.run_js(
                        f'''
                        var el = document.querySelector('select[name="{field_variants[0]}"], select#{field_variants[0]}');
                        if (el) {{
                            el.value = "{value}";
                            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        }}
                        '''
                    )
                else:
                    field.input(value)
                logger.info(f"Filled Stripe field: {label} (source: {source})")
                return True
            except Exception as e:
                logger.warning(f"Error filling {label}: {e}")
        else:
            logger.warning(f"Stripe field {label} not found (variants: {field_variants})")
        return False

    def fill_stripe_field_in_iframe(self, page, iframe, field_variants: list[str], value: str, label: str = "Field", timeout: float = 0.5):
        """Legacy method: fill a field inside a Stripe iframe.

        DEPRECATED: Use fill_stripe_field() which handles both page-DOM and iframe cases.
        """
        return self.fill_stripe_field(page, field_variants, value, label, timeout, iframe=iframe)