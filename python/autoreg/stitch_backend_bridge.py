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
import random
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

_pool_fetch_fn: Callable[[], dict[str, Any] | None] | None = None
_domain_pool_fetch_fn: Callable[[], str | None] | None = None
_outlook_pool_fetch_fn: Callable[[], dict[str, Any] | None] | None = None
_outlook_pool_mark_unusable_fn: Callable[[str, str], None] | None = None


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
        logger.debug("iCloud pool fetch not initialised (standalone mode) — pool is empty.")
        return None

    return _empty_pool


def set_outlook_pool_fetch_fn(fn: Callable[[], dict[str, Any] | None]) -> None:
    """
    Register the Outlook mailbox pool fetch function provided by stitch_backend.

    Called once during stitch_backend lifespan (outlook_mailbox_pool domain
    init) so that autoreg providers can dequeue ``provider='outlook'``
    account rows via the normal DB path.

    Args:
        fn: Callable that synchronously dequeues the next unused Outlook
            mailbox (dict with ``id``, ``email``, ``password``,
            ``refresh_token``, ``token_data``) and marks it consumed.
            Returns ``None`` when the pool is empty.
    """
    global _outlook_pool_fetch_fn  # noqa: PLW0603
    logger.info("Outlook mailbox pool fetch function registered.")
    _outlook_pool_fetch_fn = fn


def get_outlook_pool_fetch_fn() -> Callable[[], dict[str, Any] | None]:
    """
    Return the registered Outlook mailbox pool fetch function, or a no-op fallback.

    Returns:
        Callable that returns a mailbox entry dict or ``None`` when the
        pool is empty or not initialised (standalone mode).
    """
    if _outlook_pool_fetch_fn is not None:
        return _outlook_pool_fetch_fn

    def _empty_outlook_pool() -> dict[str, Any] | None:
        logger.debug(
            "Outlook mailbox pool fetch not initialised (standalone mode) — pool is empty."
        )
        return None

    return _empty_outlook_pool


def set_outlook_pool_mark_unusable_fn(fn: Callable[[str, str], None] | None) -> None:
    """
    Register (or clear with ``None``) the dead-mailbox callback.

    The Graph verifier calls it with ``(account_id, error)`` when a
    refresh token is rejected (``invalid_grant``) — first-party MSA has
    no password ROPC re-mint, so the row must leave the pool.
    """
    global _outlook_pool_mark_unusable_fn  # noqa: PLW0603
    _outlook_pool_mark_unusable_fn = fn


def get_outlook_pool_mark_unusable_fn() -> Callable[[str, str], None]:
    """
    Return the registered dead-mailbox callback, or a logging no-op fallback.
    """
    if _outlook_pool_mark_unusable_fn is not None:
        return _outlook_pool_mark_unusable_fn

    def _noop_mark_unusable(account_id: str, error: str) -> None:
        logger.warning(
            "Outlook mailbox %s unusable (%s) — no backend callback registered.",
            account_id,
            error,
        )

    return _noop_mark_unusable


def set_domain_pool_fetch_fn(fn: Callable[[], str | None] | None) -> None:
    """
    Register (or clear with ``None``) an override for the domain pool resolver.

    Used by tests and future host wiring; when unset, the default lazy
    resolver below resolves the ``DomainProviderSPI`` at call time.
    """
    global _domain_pool_fetch_fn  # noqa: PLW0603
    _domain_pool_fetch_fn = fn


def _resolve_domain_via_spi() -> str | None:
    """
    Resolve one active catch-all domain via the DomainProviderSPI.

    Returns ``None`` when stitch_backend is unavailable (standalone mode),
    no impl is registered, or the plugin returns an empty list — callers
    degrade instead of failing.
    """
    try:
        import asyncio

        from stitch_backend.core.spi import SPI_DOMAIN_PROVIDER, resolve

        impl = resolve(SPI_DOMAIN_PROVIDER)
        domains = asyncio.run(impl.list_active_domains())
        if isinstance(domains, list) and domains:
            return random.choice([str(d) for d in domains])
        return None
    except Exception:  # noqa: BLE001 — standalone / unregistered / dead plugin
        logger.debug("domain pool unavailable — standalone mode or no plugin impl")
        return None


def get_domain_pool_fetch_fn() -> Callable[[], str | None]:
    """
    Return the domain pool resolver: the injected override when set,
    otherwise the lazy DomainProviderSPI resolver with an empty-domain
    fallback (never raises).
    """
    if _domain_pool_fetch_fn is not None:
        return _domain_pool_fetch_fn
    return _resolve_domain_via_spi


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


def push_bridge_account(credential: str, meta: dict[str, Any] | None = None) -> bool:
    """
    Push an account into the stitch-bridges plugin pool via its RPC.

    Calls ``plugin.stitch-bridges.accounts_add`` through the hub
    plugin-runtime command bridge with an admin caller role (hard
    entitlement rule).  ``meta`` keys map straight to the RPC params
    (``space_id``, ``id``, ``weight``, ``proxy``); ``None`` values are
    dropped.

    Returns ``True`` only when the plugin confirms the add.  Standalone
    mode, a missing plugin host, or an RPC failure degrades to ``False``
    — never raises, so registration callers keep the account locally.
    """
    try:
        import asyncio

        from stitch_backend.domains.plugin_runtime.bridge import call_plugin_command

        params: dict[str, Any] = {"credential": credential}
        for key, value in (meta or {}).items():
            if value is not None:
                params[key] = value
        params["_caller_role"] = "admin"
        result = asyncio.run(call_plugin_command("plugin.stitch-bridges.accounts_add", params))
        return bool(isinstance(result, dict) and result.get("added"))
    except Exception:  # noqa: BLE001 — standalone / plugin not running / RPC failure
        logger.debug("bridge account push unavailable — standalone mode or RPC failure")
        return False
