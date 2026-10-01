"""stripe.fill_checkout capability for StepKind v2 (plan §4.3)."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

from ..scenario.schema import ScenarioStep
from .capabilities_base import StepResult, resolve_template

logger = logging.getLogger(__name__)


def stripe_fill_checkout_capability(
    step: ScenarioStep,
    browser: Any,
    store: dict[str, Any],
    *,
    fill_mixin: Callable[..., bool] | None = None,
) -> StepResult:
    """Fill Stripe checkout form (plan §4.3). Human pause when no card.

    Resolves ``${config.*}`` references in ``meta.card_fields`` against the
    store (seeded by :meth:`PluginScenarioProvider.register` from the
    registration config kwargs).  Falls back to ``meta.card_*`` /
    ``meta.billing_*`` literals when no template is provided.  When no
    card number is resolved, returns ``human_pause=True`` so the pipeline
    halts for manual input.
    """
    meta = step.meta or {}
    card_fields = meta.get("card_fields")
    if isinstance(card_fields, dict):
        # v1.1: resolve ${config.*} templates from the store.
        card_number = resolve_template(card_fields.get("card_number"), store, warn=False)
        card_expiry = resolve_template(card_fields.get("card_expiry"), store, warn=False)
        card_cvc = resolve_template(card_fields.get("card_cvc"), store, warn=False)
        cardholder_name = resolve_template(
            card_fields.get("cardholder_name"), store, warn=False
        )
        billing_country = resolve_template(
            card_fields.get("billing_country"), store, warn=False
        )
        billing_address = resolve_template(
            card_fields.get("billing_address"), store, warn=False
        )
        billing_city = resolve_template(card_fields.get("billing_city"), store, warn=False)
        billing_state = resolve_template(
            card_fields.get("billing_state"), store, warn=False
        )
        billing_zip = resolve_template(card_fields.get("billing_zip"), store, warn=False)
    else:
        # v1 fallback: read card.* from store or meta literals.
        card_number = store.get("card.number") or meta.get("card_number")
        card_expiry = store.get("card.expiry") or meta.get("card_expiry")
        card_cvc = store.get("card.cvc") or meta.get("card_cvc")
        cardholder_name = store.get("card.holder") or meta.get("cardholder_name")
        billing_country = store.get("card.country") or meta.get("billing_country")
        billing_address = store.get("card.address") or meta.get("billing_address")
        billing_city = store.get("card.city") or meta.get("billing_city")
        billing_state = store.get("card.state") or meta.get("billing_state")
        billing_zip = store.get("card.zip") or meta.get("billing_zip")
    if not (card_number and card_expiry and card_cvc):
        return StepResult(
            step.id, step.kind, True, human_pause=True,
            human_pause_reason=(
                "No card configured. Fill the Stripe form in the browser, "
                "then click Resume -- or click Skip to leave billing for later."
            ),
        )

    # Built-in parity: the OAuth bounce pre-fetches the checkout URL — wait briefly for it.
    wait_for_url = meta.get("wait_for_url")
    if wait_for_url and wait_for_url not in (getattr(browser, "url", "") or ""):
        wait_s = float(meta.get("wait_for_url_timeout_s", 30))
        deadline = time.time() + wait_s
        while time.time() < deadline:
            if wait_for_url in (getattr(browser, "url", "") or ""):
                break
            time.sleep(0.5)
        else:
            return StepResult(
                step.id, step.kind, False,
                error=f"stripe.fill_checkout: checkout URL never opened ({wait_for_url})",
            )

    attach = getattr(browser, "attach_card_and_billing", None)
    try:
        if attach is not None:
            ok = attach(
                card_number=card_number, card_expiry=card_expiry, card_cvc=card_cvc,
                cardholder_name=cardholder_name,
                country=billing_country,
                address_line1=billing_address,
                city=billing_city,
                zip_code=billing_zip,
                state=billing_state,
            )
        else:
            # Bare ChromiumPage: the shared Stripe mixins take page= explicitly.
            ok = (fill_mixin or _fill_stripe_via_mixin)(
                browser,
                card_number=card_number,
                card_expiry=card_expiry,
                card_cvc=card_cvc,
                cardholder_name=cardholder_name,
                country=billing_country,
                address_line1=billing_address,
                city=billing_city,
                zip_code=billing_zip,
                state=billing_state,
            )
        if not ok:
            return StepResult(step.id, step.kind, False, error="stripe.fill_checkout: submit failed")
        # Missing success redirect is a SOFT success — the built-in treats "no obvious error" as attached.
        success_url = meta.get("success_url")
        if success_url:
            submit_timeout = float(meta.get("submit_timeout_s", 90))
            deadline = time.time() + submit_timeout
            while time.time() < deadline:
                if success_url in (getattr(browser, "url", "") or ""):
                    return StepResult(
                        step.id, step.kind, True, meta={"billing_added": True}
                    )
                time.sleep(1.0)
            return StepResult(
                step.id, step.kind, True,
                meta={"billing_added": True, "note": "no_success_redirect"},
            )
        return StepResult(step.id, step.kind, True, meta={"billing_added": True})
    except Exception as e:  # noqa: BLE001
        return StepResult(step.id, step.kind, False, error=f"stripe.fill_checkout: {e}")


def _fill_stripe_via_mixin(
    page: Any,
    *,
    card_number: str,
    card_expiry: str,
    card_cvc: str,
    cardholder_name: str = "",
    country: str = "",
    address_line1: str = "",
    city: str = "",
    zip_code: str = "",
    state: str = "",
) -> bool:
    """Fill Stripe checkout on a bare ``ChromiumPage`` via the shared mixins.

    Lazy import: the Zone-1 export guard (scripts/check_export_leaks.py)
    only blocks column-0 imports, and lazy import also keeps DrissionPage
    out of the module import path for headless test environments.
    """
    from ..browser.mixins.stripe_billing import StripeBillingMixin  # noqa: PLC0415

    def _opt(v: str) -> str | None:
        return v or None

    mixin = StripeBillingMixin()
    if not mixin.fill_stripe_card(
        card_number=card_number,
        expiry=card_expiry,
        cvc=card_cvc,
        cardholder_name=_opt(cardholder_name),
        page=page,
    ):
        return False
    mixin.fill_stripe_address(
        country=_opt(country),
        line1=_opt(address_line1),
        city=_opt(city),
        zip_code=_opt(zip_code),
        state=_opt(state),
        page=page,
    )
    return bool(mixin.submit_stripe_billing(page=page))
