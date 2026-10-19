"""Email generation via the configured strategy for PluginScenarioProvider."""

from __future__ import annotations

import logging
import random
import string
from typing import TYPE_CHECKING

from ..email_providers.base import EmailContext, IEmailGenerator

if TYPE_CHECKING:
    from .provider_adapter import PluginScenarioProvider

logger = logging.getLogger("autoreg.plugin.provider_adapter")


class DomainPoolEmailGenerator(IEmailGenerator):
    """Generate emails on the active catch-all domains (domain_pool strategy).

    The domain comes from ``stitch_backend_bridge.get_domain_pool_fetch_fn``
    (DomainProviderSPI — the stitch-domains plugin); the local part is
    random, so every address on the catch-all domain is deliverable to the
    user's forwarded inbox.
    """

    def __init__(self, domain_fetch_fn) -> None:
        self._domain_fetch_fn = domain_fetch_fn

    def generate(self, description: str | None = None) -> EmailContext:
        domain = self._domain_fetch_fn()
        if not domain:
            raise ValueError(
                "domain pool empty — no active domains resolved "
                "(stitch-domains plugin not installed or no wired domains)"
            )
        local = "".join(random.choices(string.ascii_lowercase + string.digits, k=10))
        email = f"{local}@{domain}"
        logger.info("Generated domain-pool email: %s", email)
        return EmailContext(
            email=email,
            alias_id=None,
            should_cleanup=False,
            metadata={"type": "domain_pool", "description": description},
        )

    def cleanup(self, context: EmailContext) -> None:
        logger.debug("No cleanup needed for domain-pool email: %s", context.email)

    def close(self) -> None:
        pass


def generate_email(self: PluginScenarioProvider) -> str | None:
    """Generate an email via the configured strategy (generator half only).

    Verification is the scenario's job (imap.otp step), so only the
    generator is built here.  Mirrors the mapping in
    ``CommonProvider._create_email_strategy`` (Zone 2) — lazy imports
    keep the Zone-1 export guard happy and avoid heavy imports at
    module load.
    """
    strategy = (self._email_strategy or "mailtm").lower()
    try:
        if strategy == "static":
            if not self._base_email:
                return None
            from ..email_providers.generators.static import (
                StaticEmailGenerator,
            )

            gen = StaticEmailGenerator(self._base_email)
        elif strategy == "counter":
            if not self._base_email:
                return None
            from ..email_providers.generators.counter import (
                CounterEmailGenerator,
            )

            gen = CounterEmailGenerator(self._base_email)
        elif strategy in ("addyio", "addyio_counter"):
            if not self._addyio_config:
                return None
            from ..email_providers.generators.addyio import (
                AddyIoEmailGenerator,
            )

            gen = AddyIoEmailGenerator(self._addyio_config)
        elif strategy in ("33mail", "thirtythreemail"):
            cfg = self._thirty_three_mail_config
            if not cfg or not cfg.get("username"):
                return None
            from ..email_providers.generators.thirtythreemail import (
                ThirtyThreeMailGenerator,
            )

            gen = ThirtyThreeMailGenerator(cfg["username"])
        elif strategy == "mailtm":
            from ..email_providers.generators.mailtm import (
                MailTmEmailGenerator,
            )

            gen = MailTmEmailGenerator()
        elif strategy == "domain_pool":
            from ..stitch_backend_bridge import get_domain_pool_fetch_fn

            gen = DomainPoolEmailGenerator(get_domain_pool_fetch_fn())
        else:
            logger.warning(
                "plugin adapter: unsupported email strategy %r", strategy
            )
            return None
        ctx = gen.generate(description=f"{self._service} plugin registration")
        email = getattr(ctx, "email", None)
        if email:
            self.log(f"generated email via {strategy}: {email}")
        return email
    except Exception as exc:  # noqa: BLE001
        self.log(f"email generation failed: {exc}")
        return None
