"""Referral Pool Service for v0_app registrations.

Manages the queue of donor accounts, backed by the canonical ``accounts``
table (the same table the UI reads from):
- Each v0_app account can refer up to ``ref_max_count`` (default 40) new
  accounts.
- ``get_active_donor()`` returns the oldest eligible donor.
- ``get_donor_by_id()`` supports manual donor selection from the UI.
- ``increment_donor()`` is called after each successful referred registration.
- ``list_donors()`` powers the donor-picker dropdown.
- When all donors are exhausted the system falls back to the seed URL.
"""

from __future__ import annotations

import logging
from typing import Any, cast

from sqlalchemy import select

logger = logging.getLogger(__name__)

_PROVIDER = "v0_app"


def _to_dict(account: Any) -> dict[str, Any]:
    """Serialise the fields of a donor Account needed by callers."""
    return {
        "id": account.id,
        "email": account.email,
        "refCode": account.ref_code,
        "refUrl": account.ref_url,
        "refUsedCount": account.ref_used_count or 0,
        "refMaxCount": account.ref_max_count or 40,
        "status": account.status,
    }


class ReferralPoolService:
    """Select and consume referral slots from v0_app donor accounts."""

    @staticmethod
    async def get_active_donor(session: Any) -> dict[str, Any] | None:
        """Return the oldest v0_app account with ref slots available.

        Eligible = active, has a ``ref_url``, and ``ref_used_count`` below
        ``ref_max_count``.  Returns a serialised dict or ``None`` when the pool
        is empty.
        """
        from autoreg.providers.v0_app.config import V0_APP_SIGNUP_URL
        from stitch_backend.domains.accounts.models import Account

        stmt = (
            select(Account)
            .where(Account.provider == _PROVIDER)
            .where(Account.status == "active")
            .where(Account.ref_url.is_not(None))
            .where(Account.ref_used_count < Account.ref_max_count)
            .order_by(Account.created_at.asc())
            .limit(1)
        )
        donor = (await session.execute(stmt)).scalar_one_or_none()
        if donor is None:
            logger.info(
                "[referral_pool] No donor available — falling back to seed URL: %s",
                V0_APP_SIGNUP_URL,
            )
            return None
        logger.debug(
            "[referral_pool] Donor id=%s used=%s/%s url=%s",
            donor.id, donor.ref_used_count, donor.ref_max_count, donor.ref_url,
        )
        return _to_dict(donor)

    @staticmethod
    async def get_donor_by_id(session: Any, donor_id: str) -> dict[str, Any] | None:
        """Return a specific donor account by id (manual selection)."""
        from stitch_backend.domains.accounts.models import Account

        stmt = select(Account).where(Account.id == str(donor_id))
        donor = (await session.execute(stmt)).scalar_one_or_none()
        if donor is None:
            logger.warning("[referral_pool] Manual donor id=%s not found", donor_id)
            return None
        return _to_dict(donor)

    @staticmethod
    async def list_donors(session: Any) -> list[dict[str, Any]]:
        """Return all v0_app accounts that can act as donors (have a ref_url).

        Ordered oldest-first so the natural auto-pick donor appears at the top.
        """
        from stitch_backend.domains.accounts.models import Account

        stmt = (
            select(Account)
            .where(Account.provider == _PROVIDER)
            .where(Account.ref_url.is_not(None))
            .order_by(Account.created_at.asc())
        )
        rows = (await session.execute(stmt)).scalars().all()
        return [_to_dict(a) for a in rows]

    @staticmethod
    async def increment_donor(session: Any, donor_id: str) -> None:
        """Increment the referral usage counter for a donor account."""
        from stitch_backend.domains.accounts.models import Account

        stmt = select(Account).where(Account.id == str(donor_id))
        donor = (await session.execute(stmt)).scalar_one_or_none()
        if donor is None:
            logger.warning(
                "[referral_pool] increment_donor: donor id=%s not found", donor_id
            )
            return
        donor.ref_used_count = (donor.ref_used_count or 0) + 1
        await session.flush()
        logger.debug(
            "[referral_pool] Incremented donor id=%s -> %s/%s",
            donor_id, donor.ref_used_count, donor.ref_max_count,
        )

    @staticmethod
    def get_signup_url(donor: dict[str, Any] | None) -> str:
        """Return the signup URL to use: donor ref_url or the seed URL."""
        from autoreg.providers.v0_app.config import V0_APP_SIGNUP_URL
        if donor and donor.get("refUrl"):
            return cast("str", donor["refUrl"])
        return V0_APP_SIGNUP_URL
