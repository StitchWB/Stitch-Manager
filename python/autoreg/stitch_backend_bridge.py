"""
Bridge between autoreg and stitch_backend for iCloud pool access.

autoreg must not import stitch_backend directly (circular dependency risk
and environment mismatch — autoreg can run as standalone CLI without the
full FastAPI stack).  This module provides a late-bound, injectable fetch
function that callers can swap out at runtime.

When running inside stitch_backend (normal operation):
    The icloud_email_pool domain's command handler calls
    ``set_icloud_pool_fetch_fn(my_fn)`` during startup so that autoreg
    providers can dequeue pool entries via the normal DB path.

When running standalone (CLI scripts):
    The fetch function is never set, so ``get_icloud_pool_fetch_fn()``
    returns a no-op that always yields ``None``.  The generator then falls
    back to direct Apple API generation.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

_pool_fetch_fn: Callable[[], dict[str, Any] | None] | None = None


def set_icloud_pool_fetch_fn(fn: Callable[[], dict[str, Any] | None]) -> None:
    """
    Register the pool fetch function provided by stitch_backend.

    Called once during stitch_backend lifespan (icloud_email_pool domain init).

    Args:
        fn: Callable that synchronously dequeues the next available iCloud
            email pool entry from the database and marks it as used.
            Returns ``None`` when the pool is empty.
    """
    global _pool_fetch_fn  # noqa: PLW0603
    logger.info("iCloud pool fetch function registered.")
    _pool_fetch_fn = fn


def get_icloud_pool_fetch_fn() -> Callable[[], dict[str, Any] | None]:
    """
    Return the registered pool fetch function, or a no-op fallback.

    Returns:
        Callable that returns a pool entry dict (``id``, ``email``, ``label``)
        or ``None`` when the pool is empty or not initialised.
    """
    if _pool_fetch_fn is not None:
        return _pool_fetch_fn

    # Fallback: always empty — triggers direct API generation
    def _empty_pool() -> dict[str, Any] | None:
        logger.debug(
            "iCloud pool fetch not initialised (standalone mode) — pool is empty."
        )
        return None

    return _empty_pool
