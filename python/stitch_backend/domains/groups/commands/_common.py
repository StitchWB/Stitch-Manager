"""Shared helpers for the groups command handlers."""

from __future__ import annotations


def _caller_uid(params: dict) -> int | None:
    """Extract the caller's user ID (None when auth disabled / desktop)."""
    return params.get("_caller_user_id")
