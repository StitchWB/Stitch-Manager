"""Concrete email strategies implementing ``EmailStrategy`` Protocol.

Each strategy produces a unique email address for registration and can
optionally clean up afterwards (e.g. delete an alias).
"""

from __future__ import annotations

import logging
import random
import string
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from stitch_backend.core.types import RegContext

logger = logging.getLogger(__name__)


# ── Random local-part generator ─────────────────────────────────────────────

def _random_local(length: int = 12) -> str:
    """Generate a random alphanumeric local-part."""
    chars = string.ascii_lowercase + string.digits
    return "".join(random.choices(chars, k=length))


# ── Strategies ──────────────────────────────────────────────────────────────

class RandomEmailStrategy:
    """Generate a random email on a fixed domain.  No cleanup needed.

    Suitable for providers that accept any email format (e.g. throwaway).
    """

    def __init__(self, domain: str = "mailinator.com") -> None:
        self._domain = domain

    async def acquire_email(self, ctx: RegContext) -> str:
        email = f"{_random_local()}@{self._domain}"
        logger.info("RandomEmailStrategy: generated %s", email)
        return email

    async def cleanup(self, email: str) -> None:
        pass  # nothing to clean up


class CounterImapStrategy:
    """Use a catch-all IMAP domain with sequential local-parts.

    E.g. ``kiro001@mydomain.com``, ``kiro002@mydomain.com``, ...
    The counter is persisted in the settings table so it survives restarts.
    """

    def __init__(
        self,
        domain: str,
        prefix: str = "user",
        start: int = 1,
    ) -> None:
        self._domain = domain
        self._prefix = prefix
        self._counter = start

    async def acquire_email(self, ctx: RegContext) -> str:
        email = f"{self._prefix}{self._counter:04d}@{self._domain}"
        self._counter += 1
        logger.info("CounterImapStrategy: generated %s", email)
        return email

    async def cleanup(self, email: str) -> None:
        pass  # IMAP catch-all needs no cleanup


class AliasEmailStrategy:
    """Generate plus-addressed aliases of a base email.

    E.g. ``user+kiro001@gmail.com`` — works with Gmail and many providers.
    All mail arrives in the same inbox; the alias tag is used to filter.
    """

    def __init__(self, base_email: str, tag_prefix: str = "stitch") -> None:
        local, domain = base_email.rsplit("@", 1)
        self._local = local
        self._domain = domain
        self._tag_prefix = tag_prefix
        self._counter = 1

    async def acquire_email(self, ctx: RegContext) -> str:
        tag = f"{self._tag_prefix}{self._counter:04d}"
        self._counter += 1
        email = f"{self._local}+{tag}@{self._domain}"
        logger.info("AliasEmailStrategy: generated %s", email)
        return email

    async def cleanup(self, email: str) -> None:
        pass  # aliases don't need cleanup
