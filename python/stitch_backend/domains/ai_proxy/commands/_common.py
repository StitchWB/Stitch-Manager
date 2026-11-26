"""Shared private helpers for the ai_proxy command handlers."""

from __future__ import annotations

from stitch_backend.domains.ai_gateway.ownership import owner_uid_for_create


def _alias_owner_id(params: dict) -> int | None:
    """Extract caller uid for owner-scoping (None = desktop / instance-shared)."""
    return params.get("_caller_user_id")


def _alias_owner_id_for_create(params: dict) -> int | None:
    """Owner for newly created alias rows; desktop rows are instance-shared."""
    return owner_uid_for_create(_alias_owner_id(params))
