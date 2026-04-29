"""Mixin for Stripe checkout iframe handling"""
import logging
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
    
    def fill_stripe_field_in_iframe(self, page, iframe, field_variants: list[str], value: str, label: str = "Field", timeout: float = 0.5):
        """Fill a field inside a Stripe iframe using multiple selector variants.
        
        Args:
            page: ChromiumPage
            iframe: The iframe element containing the field
            field_variants: List of possible field name attributes (e.g. ['cardNumber', 'number'])
            value: Value to fill
            label: Log label for this field
            timeout: Timeout per selector attempt
            
        Returns:
            bool: success
        """
        if not value:
            return False
        
        frame = page.get_frame(iframe)
        if not frame:
            logger.warning(f"Could not get frame for {label}")
            return False
        
        field = None
        for variant in field_variants:
            selectors = [
                f'css:input[name="{variant}"]',
                f'css:input#{variant}',
                f'css:input[placeholder*="{variant}"]',
                f'css:input[aria-label*="{variant}"]',
            ]
            for sel in selectors:
                try:
                    field = frame.ele(sel, timeout=timeout)
                    if field:
                        break
                except:
                    pass
            if field:
                break
        
        if field:
            try:
                field.click()
                self.human_delay(0.05, 0.1) if hasattr(self, 'human_delay') else __import__('time').sleep(0.1)
                field.input(value)
                logger.info(f"Filled Stripe field: {label}")
                return True
            except Exception as e:
                logger.warning(f"Error filling {label}: {e}")
        else:
            logger.warning(f"Stripe field {label} not found in iframe (variants: {field_variants})")
        return False