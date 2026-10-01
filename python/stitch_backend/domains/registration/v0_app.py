"""v0_app pre-flight — auto-proxy selection and referral-donor resolution."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

# Logger name pinned to the pre-split service module — must not change.
logger = logging.getLogger("stitch_backend.domains.registration.service")


async def _prepare_v0_app(
    job_id: str, config: dict, log_callback: Callable[[str], None]
) -> tuple[dict, str | None]:
    """Resolve proxy rotation + referral donor; returns (config, donor_id)."""
    from stitch_backend.database import run_in_session
    from stitch_backend.domains.registration.proxy_selector import ProxySelector
    from stitch_backend.domains.registration.referral_pool import ReferralPoolService

    _donor_id: str | None = None  # track donor for post-save increment
    # Auto-pick proxy ONLY when explicitly opted in — a dead library proxy caused ERR_EMPTY_RESPONSE.
    auto_proxy_enabled = bool(
        config.get("auto_proxy")
        or config.get("autoProxy")
        or config.get("proxy_rotation")
        or config.get("proxyRotation")
    )
    if auto_proxy_enabled and not config.get("proxy_url"):
        try:
            async def _pick_proxy(session):
                return await ProxySelector.next_proxy(session)
            proxy_entry = await run_in_session(_pick_proxy)
            if proxy_entry:
                config = dict(config)  # copy — do not mutate caller's dict
                config["proxy_url"] = ProxySelector.build_proxy_url(proxy_entry)
                config["proxy_type"] = proxy_entry.get("proxy_type", "http")
                config["proxy_username"] = proxy_entry.get("proxy_username")
                config["proxy_password"] = proxy_entry.get("proxy_password")
                # Visible in the registration console so a bad proxy is obvious, not a silent failure.
                log_callback(
                    f"[proxy] Auto-rotation ON — using proxy "
                    f"{proxy_entry.get('proxy_url')}"
                )
                logger.info(
                    "Registration %s: auto-proxy %s",
                    job_id, proxy_entry.get("proxy_url"),
                )
            else:
                log_callback(
                    "[proxy] Auto-rotation ON but no enabled proxy in "
                    "library — continuing with a direct connection"
                )
        except Exception as proxy_exc:
            log_callback(
                f"[proxy] Auto-select failed ({proxy_exc}) — "
                f"continuing with a direct connection"
            )
            logger.warning(
                "Registration %s: proxy auto-select failed (continuing without proxy): %s",
                job_id, proxy_exc,
            )
    elif config.get("proxy_url"):
        log_callback(f"[proxy] Using configured proxy {config.get('proxy_url')}")

    # UI passes a custom referral link as camelCase signupUrl — normalize so donor selection is skipped.
    _custom_signup_url = (
        config.get("signup_url")
        or config.get("signupUrl")
    )
    if _custom_signup_url and not config.get("signup_url"):
        config = dict(config)
        config["signup_url"] = str(_custom_signup_url).strip()

    # Manual donor (referred_by_id) wins; otherwise auto-pick the oldest eligible donor.
    if config.get("signup_url"):
        log_callback(
            f"[v0_app] Using custom referral link: {config.get('signup_url')}"
        )
    if not config.get("signup_url"):
        manual_donor_id = (
            config.get("referred_by_id") or config.get("referredById")
        )
        try:
            async def _pick_donor(session):
                if manual_donor_id:
                    return await ReferralPoolService.get_donor_by_id(
                        session, str(manual_donor_id)
                    )
                return await ReferralPoolService.get_active_donor(session)
            donor = await run_in_session(_pick_donor)
            config = dict(config)
            config["signup_url"] = ReferralPoolService.get_signup_url(donor)
            if donor and donor.get("refUrl"):
                _donor_id = donor.get("id")
                logger.info(
                    "Registration %s: using %s referral donor id=%s url=%s",
                    job_id,
                    "manual" if manual_donor_id else "auto",
                    _donor_id,
                    config["signup_url"],
                )
            else:
                logger.info(
                    "Registration %s: no usable donor — using seed URL %s",
                    job_id, config["signup_url"],
                )
        except Exception as donor_exc:
            logger.warning(
                "Registration %s: donor selection failed (using seed URL): %s",
                job_id, donor_exc,
            )

    return config, _donor_id
