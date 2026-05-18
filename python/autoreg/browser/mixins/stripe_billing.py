"""
Stripe checkout billing helper.

High-level mixin on top of :class:`StripeIframeMixin` that fills the
Stripe-checkout payment + address fields for *any* provider. Intentionally
does **not** know about the surrounding flow (when to navigate, when
to expand the card form, when to click submit) — providers wire those bits.

Reusable across Fireworks, Kiro v2, and future providers that hit Stripe
checkout. Multilingual selectors are baked in (English / German / Russian).

Typical usage:

.. code-block:: python

    class MyProviderBrowser(BaseBrowser, ..., StripeBillingMixin):
        def attach_card(self, card, billing):
            self.fill_stripe_card(
                card_number=card.number,
                expiry=card.expiry_mmyy,
                cvc=card.cvv,
                cardholder_name=billing.name,
            )
            self.fill_stripe_address(
                country=billing.country,
                line1=billing.address,
                city=billing.city,
                zip_code=billing.zip,
                state=billing.state,
            )
            self.submit_stripe_billing()
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Optional

from .stripe_iframe import StripeIframeMixin

if TYPE_CHECKING:
    from DrissionPage import ChromiumPage

logger = logging.getLogger(__name__)


# Multilingual field-name variants. The order matters — the most likely
# ``input[name=...]`` first so we hit it on the first try.

CARD_NUMBER_VARIANTS = ["cardNumber", "number", "Kartennummer", "Номер карты"]
EXPIRY_VARIANTS = ["cardExpiry", "expiry", "Ablaufdatum", "Срок окончания"]
CVC_VARIANTS = ["cardCvc", "cvc", "Prüfziffer", "CVV"]
NAME_VARIANTS = [
    "billingName",
    "name",
    "Name auf der Karte",
    "Имя владельца",
    "Имя владельца карты",
]
ADDRESS_LINE1_VARIANTS = [
    "billingAddressLine1",
    "address",
    "Adresse",
    "Адрес",
    "Адрес (строка 1)",
]
CITY_VARIANTS = ["billingLocality", "city", "Ort", "Город"]
ZIP_VARIANTS = ["billingPostalCode", "postalCode", "Postleitzahl", "Почтовый индекс"]
STATE_VARIANTS = ["billingAdministrativeArea", "state", "Bundesland", "Штат", "Район"]
COUNTRY_VARIANTS = [
    "billingCountry",
    "country",
    "billing-country",
    "billing_address_country",
]

SUBMIT_SELECTORS = [
    "div.SubmitButton-IconContainer",
    'css:button[data-testid="hosted-payment-submit-button"]',
    "css:button.SubmitButton--complete",
    "text=Subscribe",
    "text=Pay",
    "text=Оплатить",
]


class StripeBillingMixin(StripeIframeMixin):
    """Fill Stripe-checkout payment and address forms.

    Inherits from :class:`StripeIframeMixin` for the underlying
    ``fill_stripe_field`` mechanism. Adds high-level methods that know which
    field variants and tag types to use for each Stripe field.
    """

    def fill_stripe_card(
        self,
        *,
        card_number: str,
        expiry: str,
        cvc: str,
        cardholder_name: Optional[str] = None,
        page: Optional["ChromiumPage"] = None,
    ) -> bool:
        """Fill the four payment-card fields.

        Args:
            card_number: Card number in any human-readable format (spaces ok).
            expiry: ``MM/YY`` or ``MM / YY``.
            cvc: 3- or 4-digit CVC.
            cardholder_name: Optional cardholder name; skipped if ``None``.
            page: Page to operate on (defaults to ``self.page``).

        Returns:
            ``True`` if at least the card number was filled.
        """
        page = page or getattr(self, "page", None)
        if not page:
            raise RuntimeError("No page available for Stripe card fill")

        iframe = self.find_stripe_iframe(page, iframe_type="payment", timeout=5)

        ok = self.fill_stripe_field(
            page, CARD_NUMBER_VARIANTS, card_number, "Card Number", iframe=iframe
        )
        self.fill_stripe_field(
            page, EXPIRY_VARIANTS, expiry, "Expiry", iframe=iframe
        )
        self.fill_stripe_field(
            page, CVC_VARIANTS, cvc, "CVC", iframe=iframe
        )
        if cardholder_name:
            self.fill_stripe_field(
                page,
                NAME_VARIANTS,
                cardholder_name,
                "Cardholder Name",
                iframe=iframe,
            )
        return ok

    def fill_stripe_address(
        self,
        *,
        country: Optional[str] = None,
        line1: Optional[str] = None,
        city: Optional[str] = None,
        zip_code: Optional[str] = None,
        state: Optional[str] = None,
        page: Optional["ChromiumPage"] = None,
    ) -> bool:
        """Fill billing address fields.

        Args:
            country: 2-letter country code (e.g. ``"US"``); filled via select.
            line1: Street address.
            city: City.
            zip_code: Postal / ZIP code.
            state: State / region (handled as ``select`` when present).
            page: Page to operate on (defaults to ``self.page``).

        Returns:
            ``True`` if at least one field was filled successfully.
        """
        page = page or getattr(self, "page", None)
        if not page:
            raise RuntimeError("No page available for Stripe address fill")

        iframe = self.find_stripe_iframe(page, iframe_type="address", timeout=5)
        any_filled = False

        if country:
            any_filled |= self.fill_stripe_field(
                page,
                COUNTRY_VARIANTS,
                country,
                "Country",
                iframe=iframe,
                field_type="select",
            )
        if line1:
            any_filled |= self.fill_stripe_field(
                page, ADDRESS_LINE1_VARIANTS, line1, "Address Line 1", iframe=iframe
            )
        if city:
            any_filled |= self.fill_stripe_field(
                page, CITY_VARIANTS, city, "City", iframe=iframe
            )
        if zip_code:
            any_filled |= self.fill_stripe_field(
                page, ZIP_VARIANTS, zip_code, "ZIP", iframe=iframe
            )
        if state:
            any_filled |= self.fill_stripe_field(
                page,
                STATE_VARIANTS,
                state,
                "State",
                iframe=iframe,
                field_type="select",
            )

        return bool(any_filled)

    def submit_stripe_billing(
        self, page: Optional["ChromiumPage"] = None
    ) -> bool:
        """Click the Stripe submit/pay button.

        Tries each known submit-button selector in order; returns ``True`` on
        the first successful click.
        """
        page = page or getattr(self, "page", None)
        if not page:
            raise RuntimeError("No page available for Stripe submit")

        for selector in SUBMIT_SELECTORS:
            try:
                btn = page.ele(selector, timeout=0.5)
                if btn:
                    btn.click()
                    logger.info("Stripe submit clicked via %s", selector)
                    return True
            except Exception:  # noqa: BLE001
                continue
        logger.warning("Stripe submit button not found")
        return False


__all__ = ["StripeBillingMixin"]
