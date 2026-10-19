"""Shared private helpers for the ai_proxy command handlers."""

from __future__ import annotations


def _alias_owner_id(params: dict) -> int | None:
    """Extract caller uid for owner-scoping (None = desktop / instance-shared)."""
    return params.get("_caller_user_id")
