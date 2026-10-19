from __future__ import annotations

import time
from collections.abc import Iterable, Mapping

AccountRecord = Mapping[str, str | int | float | bool | None]


def select_available_account(
    accounts: Iterable[AccountRecord],
    *,
    provider: str,
    now: int | None = None,
) -> AccountRecord | None:
    """Return the first enabled, non-cooled-down account for a provider."""
    current = int(time.time()) if now is None else now
    for account in accounts:
        if str(account.get("provider", "")).lower() != provider.lower():
            continue
        if not account.get("enabled", True):
            continue
        cooldown_until = account.get("cooldownUntil") or account.get("cooldown_until") or 0
        if isinstance(cooldown_until, (int, float)) and cooldown_until > current:
            continue
        return account
    return None
