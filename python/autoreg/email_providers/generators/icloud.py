"""
iCloud Hide My Email generator.

Pulls addresses from a pre-filled pool managed by the icloud_email_pool
stitch_backend domain, rather than calling Apple's API on every registration.
This sidesteps Apple's per-account rate limit (~5 aliases / 30 min).

The pool is filled by a background worker (icloud_email_pool domain) that
drips aliases into SQLite at Apple's allowed pace.  The generator simply
dequeues the next available address.

Pool miss behaviour:
  - If pool is empty, falls back to calling Apple API directly (may raise
    RateLimitError which the caller can handle by retrying later).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from ..base import EmailContext, IEmailGenerator

logger = logging.getLogger(__name__)


class ICloudPoolEmailGenerator(IEmailGenerator):
    """
    Email generator backed by an iCloud Hide My Email address pool.

    Two modes:
      1. **Pool mode** (default): ``pool_fetch_fn`` is provided.  The generator
         calls it to claim the next available email from the SQLite pool.
      2. **Direct mode**: ``service`` is provided.  The generator calls Apple's
         API directly and stores the result (useful for warming the pool).

    Args:
        pool_fetch_fn: Callable that returns the next available email from
            the pool, or ``None`` if the pool is empty.  Signature::

                def fetch() -> dict | None:
                    # {"id": "...", "email": "...", "label": "..."}

        service: Optional ``ICloudService`` instance for direct-mode fallback.
        label_prefix: Prefix for the alias label (e.g. provider name).
    """

    def __init__(
        self,
        pool_fetch_fn: Callable[[], dict[str, Any] | None] | None = None,
        service: Any | None = None,
        label_prefix: str = "Auto-registration",
    ) -> None:
        if pool_fetch_fn is None and service is None:
            raise ValueError(
                "ICloudPoolEmailGenerator requires either pool_fetch_fn or service."
            )
        self._pool_fetch = pool_fetch_fn
        self._service = service
        self._label_prefix = label_prefix

    # ── IEmailGenerator interface ─────────────────────────────────────────────

    def generate(self, description: str | None = None) -> EmailContext:
        """
        Claim one iCloud alias.

        Tries the pool first; falls back to direct API if pool is empty and
        a service is configured.

        Args:
            description: Optional label / description for the alias.

        Returns:
            EmailContext with the alias email.

        Raises:
            RuntimeError: Pool is empty and no service is configured, or
                Apple API rate limit hit.
        """
        label = description or self._label_prefix

        # ── Pool path ──
        if self._pool_fetch is not None:
            entry = self._pool_fetch()
            if entry is not None:
                email = entry["email"]
                alias_id = entry.get("id", "")
                logger.info("Claimed iCloud alias from pool: %s", email)
                return EmailContext(
                    email=email,
                    alias_id=alias_id,
                    should_cleanup=False,   # Pool entries are reusable / retained
                    metadata={
                        "type": "icloud_pool",
                        "label": entry.get("label", label),
                        "source": "pool",
                    },
                )
            logger.warning(
                "iCloud email pool is empty — falling back to direct API generation."
            )

        # ── Direct API path ──
        if self._service is None:
            raise RuntimeError(
                "iCloud email pool is empty and no ICloudService is configured. "
                "Fill the pool first via Settings → Email Services → iCloud."
            )

        alias = self._service.generate_alias(label)
        logger.info("Generated iCloud alias directly: %s", alias["email"])
        return EmailContext(
            email=alias["email"],
            alias_id=alias["id"],
            should_cleanup=False,
            metadata={
                "type": "icloud_direct",
                "label": label,
                "source": "direct",
            },
        )

    def cleanup(self, context: EmailContext) -> None:
        """
        iCloud aliases are kept active (forwarding continues to main iCloud inbox).
        Cleanup is a no-op by default — deletion is explicit via pool management UI.
        """
        logger.debug(
            "iCloud alias cleanup skipped for %s (aliases are retained).",
            context.email,
        )

    def close(self) -> None:
        if self._service is not None:
            self._service.close()
