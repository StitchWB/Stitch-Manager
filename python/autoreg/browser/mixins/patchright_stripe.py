"""Stripe iframe mixin for PatchrightEngine."""
from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger(__name__)


class PatchrightStripeMixin:
    """Handles Stripe card input in iframes using Patchright."""

    def _fill_stripe_card(
        self,
        page: Any,
        card_number: str,
        expiry: str,
        cvc: str,
        billing_name: str | None = None,
        billing_address: str | None = None,
        billing_city: str | None = None,
        billing_zip: str | None = None,
    ) -> bool:
        """Fill Stripe card details in nested iframes."""
        logger.info("[Stripe] Filling card details...")

        try:
            # Wait for Stripe iframe
            stripe_frame = page.wait_for_selector(
                'iframe[name*="__privateStripeFrame"], iframe[src*="js.stripe.com"]',
                timeout=15000,
            )
            if not stripe_frame:
                logger.error("[Stripe] Stripe iframe not found")
                return False

            # Get frame handle
            frame = stripe_frame.content_frame()
            if not frame:
                logger.error("[Stripe] Could not access iframe content")
                return False

            # Fill card number
            number_input = frame.wait_for_selector(
                'input[name="cardnumber"], input[data-elements-stable-field-name="cardNumber"]',
                timeout=10000,
            )
            if number_input:
                for digit in card_number:
                    number_input.type(digit)
                    time.sleep(0.05)
                logger.info("[Stripe] Card number filled")

            # Fill expiry
            expiry_input = frame.wait_for_selector(
                'input[name="exp-date"], input[data-elements-stable-field-name="cardExpiry"]',
                timeout=5000,
            )
            if expiry_input:
                expiry_input.fill(expiry)
                logger.info("[Stripe] Expiry filled")

            # Fill CVC
            cvc_input = frame.wait_for_selector(
                'input[name="cvc"], input[data-elements-stable-field-name="cardCvc"]',
                timeout=5000,
            )
            if cvc_input:
                cvc_input.fill(cvc)
                logger.info("[Stripe] CVC filled")

            # Fill billing name if present
            if billing_name:
                name_input = frame.query_selector(
                    'input[name="name"], input[data-elements-stable-field-name="name"]'
                )
                if name_input:
                    name_input.fill(billing_name)

            # Fill billing address if present
            if billing_address:
                addr_input = frame.query_selector(
                    'input[name="address"], input[data-elements-stable-field-name="addressLine1"]'
                )
                if addr_input:
                    addr_input.fill(billing_address)

            if billing_city:
                city_input = frame.query_selector(
                    'input[name="city"], input[data-elements-stable-field-name="addressCity"]'
                )
                if city_input:
                    city_input.fill(billing_city)

            if billing_zip:
                zip_input = frame.query_selector(
                    'input[name="postal"], input[data-elements-stable-field-name="addressZip"]'
                )
                if zip_input:
                    zip_input.fill(billing_zip)

            logger.info("[Stripe] Card details filled successfully")
            return True

        except Exception as e:
            logger.error(f"[Stripe] Error filling card: {e}")
            return False

    def _click_stripe_submit(self, page: Any) -> bool:
        """Click Stripe submit button."""
        try:
            # Common Stripe submit selectors
            selectors = [
                'button[type="submit"]',
                'button:has-text("Submit")',
                'button:has-text("Pay")',
                '.SubmitButton',
                '[data-testid="submit-button"]',
            ]
            for sel in selectors:
                btn = page.query_selector(sel)
                if btn:
                    btn.click()
                    logger.info("[Stripe] Submit button clicked")
                    return True
            logger.warning("[Stripe] Submit button not found")
            return False
        except Exception as e:
            logger.error(f"[Stripe] Error clicking submit: {e}")
            return False


__all__ = ["PatchrightStripeMixin"]
