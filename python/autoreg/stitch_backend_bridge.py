"""
Bridge between autoreg and stitch_backend — the only sanctioned seam.

autoreg must not import stitch_backend directly (circular dependency risk
and environment mismatch — autoreg can run as standalone CLI without the
full FastAPI stack).  Every cross-zone lookup goes through a function here
that late-binds the import; in standalone mode each accessor degrades to a
documented fallback instead of failing at import time.  Enforced by
``python/scripts/check_zone_boundary.py`` (CHECK 3).

iCloud pool access is injection-based:

    When running inside stitch_backend (normal operation):
        The icloud_email_pool domain's command handler calls
        ``set_icloud_pool_fetch_fn(my_fn)`` during startup so that autoreg
        providers can dequeue pool entries via the normal DB path.

    When running standalone (CLI scripts):
        The fetch function is never set, so ``get_icloud_pool_fetch_fn()``
        returns a no-op that always yields ``None``.  The generator then
        falls back to direct Apple API generation.
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


def get_outbound_proxy() -> str | None:
    """
    Return the configured outbound proxy URL, or ``None``.

    Reads the kiro-patch config via stitch_backend; ``None`` when no proxy
    is configured or stitch_backend is unavailable (standalone mode).
    """
    try:
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy

        return _get_outbound_proxy()
    except Exception:  # noqa: BLE001
        logger.debug("Outbound proxy unavailable — continuing without one.")
        return None


def get_database_path() -> str | None:
    """
    Return the stitch_backend SQLite database path, or ``None`` in standalone mode.
    """
    try:
        from stitch_backend.config import get_database_path as _impl
    except ImportError:
        logger.warning("stitch_backend unavailable — database path unknown.")
        return None
    return str(_impl())


def register_builtin_spis() -> None:
    """
    Import stitch_backend's built-in SPI modules (registration side effect).

    No-op in standalone mode; SPI resolution then fails at call time.
    """
    try:
        import stitch_backend.core.spi_builtin_email  # noqa: F401
    except ImportError:
        logger.warning("stitch_backend unavailable — built-in SPIs not registered.")


def resolve_email_verification() -> Any:
    """
    Resolve the registered EmailVerificationProvider SPI implementation.

    Propagates whatever ``stitch_backend.core.spi.resolve`` raises
    (ImportError when stitch_backend is absent, SpiNotRegistered when no
    impl is registered) — callers already handle failure.
    """
    from stitch_backend.core.spi import SPI_EMAIL_VERIFICATION, resolve

    return resolve(SPI_EMAIL_VERIFICATION)
