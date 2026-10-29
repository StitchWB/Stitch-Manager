"""Ordered role ladder for tier-gating (scenarios, future perks).

Roles are plain strings on ``auth_users.role``; this module gives them a
numeric ordering so features can declare a minimum tier:

    user < vip < premium < elite < admin

``admin`` doubles as the system-management role (admin zone) and the top
consumer tier.  Unknown / missing roles sort below ``user`` so a corrupted
row never unlocks anything.
"""

from __future__ import annotations

ROLE_LEVELS: dict[str, int] = {
    "user": 1,
    "vip": 2,
    "premium": 3,
    "elite": 4,
    "admin": 5,
}

#: Role assigned to newly created users (TG bootstrap may override).
DEFAULT_ROLE: str = "user"

#: Roles selectable in the admin UI, ordered for dropdowns.
SELECTABLE_ROLES: tuple[str, ...] = ("user", "vip", "premium", "elite", "admin")


def role_level(role: str | None) -> int:
    """Numeric level of *role*; unknown or ``None`` → 0 (below user)."""
    return ROLE_LEVELS.get(role or "", 0)


def role_at_least(role: str | None, min_role: str) -> bool:
    """True when *role* satisfies the *min_role* tier requirement."""
    return role_level(role) >= role_level(min_role)


def valid_role(role: str) -> bool:
    """True when *role* is one of the known ladder roles."""
    return role in ROLE_LEVELS
