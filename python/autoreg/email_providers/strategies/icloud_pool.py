"""
iCloud Pool email strategy.

Combines ICloudPoolEmailGenerator with an IMAP verifier pointed at the
main iCloud inbox (imap.mail.me.com:993).  All Hide My Email aliases forward
to the account's primary iCloud address, so standard IMAP verification works
without any extra setup.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from ..generators.icloud import ICloudPoolEmailGenerator
from ..verifiers.imap import ImapVerifier
from .base import BaseStrategy

logger = logging.getLogger(__name__)


class ICloudPoolStrategy(BaseStrategy):
    """
    Email strategy backed by the iCloud Hide My Email address pool.

    - **Generation**: dequeues the next available alias from the pool
      (filled asynchronously by the background worker in the
      ``icloud_email_pool`` stitch_backend domain).
    - **Verification**: reads incoming mail from iCloud via IMAP.
      All HME aliases forward to the primary iCloud address, so no
      per-alias IMAP configuration is needed.

    Args:
        pool_fetch_fn: Callable returning the next available pool entry
            (dict with ``id`` and ``email``) or ``None`` when empty.
        imap_config: IMAP credentials for iCloud
            (``imap.mail.me.com``:993, Apple ID + app-specific password).
        icloud_service: Optional ICloudService for direct generation fallback.
        label_prefix: Prefix used for alias labels.
    """

    # iCloud IMAP defaults — callers can override via imap_config
    ICLOUD_IMAP_HOST = "imap.mail.me.com"
    ICLOUD_IMAP_PORT = 993

    def __init__(
        self,
        pool_fetch_fn: Callable[[], dict | None],
        imap_config: dict[str, Any] | None = None,
        icloud_service: Any | None = None,
        label_prefix: str = "Auto-registration",
    ) -> None:
        generator = ICloudPoolEmailGenerator(
            pool_fetch_fn=pool_fetch_fn,
            service=icloud_service,
            label_prefix=label_prefix,
        )

        verifier: ImapVerifier | None = None
        if imap_config:
            # Inject iCloud IMAP defaults if host not specified
            merged = {
                "host": self.ICLOUD_IMAP_HOST,
                "port": self.ICLOUD_IMAP_PORT,
                **imap_config,
            }
            verifier = ImapVerifier(merged)
            logger.debug(
                "ICloudPoolStrategy: IMAP verifier → %s:%s",
                merged["host"],
                merged["port"],
            )

        super().__init__(generator=generator, verifier=verifier)
        logger.debug("ICloudPoolStrategy initialised (verifier=%s)", verifier is not None)
