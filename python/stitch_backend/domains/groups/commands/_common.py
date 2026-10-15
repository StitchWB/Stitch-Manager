"""Shared helpers for the groups command handlers."""

from __future__ import annotations

from stitch_backend.core.exceptions import StitchError


def _caller_uid(params: dict) -> int | None:
    """Extract the caller's user ID (None when auth disabled / desktop)."""
    return params.get("_caller_user_id")


def _require_caller_identity(params: dict) -> None:
    # desktop guest is uid=None with role='admin' (cmd_dispatcher); anonymous non-admin must not bypass ownership checks
    if params.get("_caller_user_id") is None and params.get("_caller_role") != "admin":
        raise StitchError("Authentication required")
