"""Account identifier normalization shared by command handlers."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from stitch_backend.core.exceptions import StitchError

if TYPE_CHECKING:
    from collections.abc import Mapping

_NULLISH = {"", "none", "null", "undefined"}


def normalize_account_id(raw: Any) -> int | str | None:
    """Return an int for numeric ids, a str for opaque ids, or None when absent/invalid."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text or text.lower() in _NULLISH:
        return None
    return int(text) if text.isdigit() else text


def require_account_id(params: Mapping[str, Any], *keys: str) -> int | str:
    """Read the first present alias in ``keys`` and return a valid id, else raise."""
    for key in keys:
        if key in params:
            account_id = normalize_account_id(params[key])
            if account_id is not None:
                return account_id
    raise StitchError("accountId is required")
