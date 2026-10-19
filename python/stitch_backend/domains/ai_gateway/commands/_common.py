"""Owner-isolation helpers (mirrors domains/accounts & email_inbox)."""

from __future__ import annotations

from sqlalchemy import or_


def _caller_uid(params: dict) -> int | None:
    """Extract the caller's user ID (None when auth disabled / desktop)."""
    return params.get("_caller_user_id")


def _owner_filter(model, uid: int | None):
    """WHERE clause: owner_id IS NULL OR owner_id = uid (legacy shared pool).

    P2.15 — divergence from ``PoolScope``: ``_owner_filter`` and
    ``PoolScope`` both express "caller sees own + instance-shared rows"
    but at different layers.  ``_owner_filter`` is a SQL WHERE clause
    applied to a single table in command handlers (CRUD scope).
    ``PoolScope`` is a runtime object passed to the routing engine
    (request-time routing scope).  They diverge in edge cases:
    ``PoolScope.include_instance_shared`` can be False (desktop →
    False would hide shared rows from routing), while
    ``_owner_filter`` always includes NULL-owner rows (CRUD always
    shows shared rows).  This is intentional: CRUD visibility ≠
    routing eligibility.

    ── Divergence from ``accounts.AccountService._check_ownership``
    (intentional) ──

    The accounts domain's ``_check_ownership`` is *desktop-permissive*:
    ``caller_uid`` None means "no auth, allow everything" (single-trusted-
    user desktop model).  This ``_owner_filter`` takes the opposite
    stance: ``uid`` None matches *shared rows only* (``owner_id IS
    NULL``), hiding user-owned rows from unauthenticated callers.  Both
    postures are intentional legacy-compat decisions — do NOT "align"
    them without a migration plan (see the counterpart docstring on
    ``AccountService._check_ownership``).
    """
    return or_(model.owner_id.is_(None), model.owner_id == uid)
