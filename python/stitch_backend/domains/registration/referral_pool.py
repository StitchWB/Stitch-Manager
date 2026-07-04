"""Referral Pool Service for v0_app registrations.

Manages the queue of donor accounts:
- Each v0_app account can refer up to V0_APP_REF_QUOTA (40) new accounts.
- get_active_donor() returns the oldest account with ref slots remaining.
- increment_donor() is called after each successful referred registration.
- When all donors are exhausted the system falls back to the seed URL.
"""

from __future__ import annotations

import logging
from typing import Any

from autoreg.providers.v0_app.config import V0_APP_SIGNUP_URL

logger = logging.getLogger(__name__)


class ReferralPoolService:
    """Select and consume referral slots from v0_app donor accounts."""

    @staticmethod
    async def get_active_donor(session: Any) -> dict[str, Any] | None:
        """Return the oldest v0_app account with ref slots available.

        Returns a full account dict (from _row_to_account) or None when the
        pool is empty / no accounts have a ref_url yet.
        """
        from stitch_backend.domains.ai_proxy.service import AiProxyAccountStore
        donor = await AiProxyAccountStore.get_donor(session, provider="v0_app")
        if donor:
            logger.debug(
                "[referral_pool] Donor id=%s used=%s/%s url=%s",
                donor.get("id"),
                donor.get("refUsedCount"),
                donor.get("refMaxCount"),
                donor.get("refUrl"),
            )
        else:
            logger.info(
                "[referral_pool] No donor available — falling back to seed URL: %s",
                V0_APP_SIGNUP_URL,
            )
        return donor

    @staticmethod
    async def increment_donor(session: Any, donor_id: int) -> None:
        """Increment the referral usage counter for a donor account."""
        from stitch_backend.domains.ai_proxy.service import AiProxyAccountStore
        await AiProxyAccountStore.increment_donor(session, donor_id)
        logger.debug("[referral_pool] Incremented donor id=%s", donor_id)

    @staticmethod
    def get_signup_url(donor: dict[str, Any] | None) -> str:
        """Return the signup URL to use: donor ref_url or the seed URL."""
        if donor and donor.get("refUrl"):
            return donor["refUrl"]
        return V0_APP_SIGNUP_URL
