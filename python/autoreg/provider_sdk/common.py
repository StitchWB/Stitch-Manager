"""
Common Provider - Shared functionality for all providers.

Canonical location: ``autoreg.provider_sdk`` (ADR-005).  ``autoreg.providers.common``
is a backwards-compat shim.

This module provides a CommonProvider base class that eliminates duplication
across all providers by centralizing:
- Initialization logic (headless, imap_config, email_strategy)
- Email strategy creation (static, counter, addyio, addyio_counter, mailtm, 33mail)
- Browser and registration instance management
- Logging functionality
- Cleanup/close methods
"""

import logging
from collections.abc import Callable
from typing import Any

from .base import BaseProvider

logger = logging.getLogger(__name__)


class CommonProvider(BaseProvider):
    """
    Common provider base class with shared functionality.

    Provides:
    - Standard `__init__` with headless, imap_config, email_strategy and all strategy configs
    - _create_email_strategy() handling all strategy types centrally
    - Browser and registration instance management
    - Log callback handling
    - Cleanup logic
    """

    def __init__(
        self,
        headless: bool = False,
        imap_config: dict | None = None,
        email_strategy: str = "static",
        base_email: str | None = None,
        addyio_config: Any = None,
        thirty_three_mail_config: dict | None = None,
        mailtm_inbox_config: dict | None = None,
        icloud_config: Any = None,
    ):
        """
        Initialize common provider.

        Args:
            headless: Run browser in headless mode
            imap_config: IMAP configuration for email verification
            email_strategy: Email generation strategy (static, counter, addyio, addyio_counter, mailtm, 33mail, icloud_pool)
            base_email: Base email address (required for static/counter strategies)
            addyio_config: Addy.io configuration (required for addyio strategies)
            thirty_three_mail_config: 33mail configuration dict with 'username' and optional 'domain' (required for 33mail strategy)
            mailtm_inbox_config: Existing Mail.tm inbox configuration for verification
            icloud_config: ICloudConfig instance (required for icloud_pool strategy)
        """
        super().__init__(headless)
        self.imap_config = imap_config or {}
        self.email_strategy = email_strategy
        self.base_email = base_email
        self.addyio_config = addyio_config
        self.thirty_three_mail_config = thirty_three_mail_config
        self.mailtm_inbox_config = mailtm_inbox_config or {}
        self.icloud_config = icloud_config
        self.email_strategy_instance: Any | None = None
        self.browser: Any | None = None
        self._registration: Any | None = None

        self._create_email_strategy()

    def _create_email_strategy(self):
        """
        Create email strategy instance based on configuration.

        Supports: static, counter, addyio, addyio_counter, mailtm, 33mail, thirtythreemail, icloud_pool
        Stores the result in self.email_strategy_instance.
        """
        from ..email_providers.generators import (
            AddyIoEmailGenerator,
            CounterEmailGenerator,
            StaticEmailGenerator,
            ThirtyThreeMailGenerator,
        )
        from ..email_providers.strategies import (
            AddyIoImapStrategy,
            BaseStrategy,
            CounterImapStrategy,
            ICloudPoolStrategy,
            MailTmStrategy,
            StaticImapStrategy,
        )
        from ..email_providers.verifiers import ImapVerifier
        from ..services.mailtm import MailTmConfig
        from ..shared.models import EmailStrategy

        verifier = ImapVerifier(self.imap_config) if self.imap_config else None

        strategy_map = {
            'static': EmailStrategy.STATIC,
            'counter': EmailStrategy.COUNTER,
            'addyio': EmailStrategy.ADDYIO,
            'addyio_counter': EmailStrategy.ADDYIO_COUNTER,
            'mailtm': EmailStrategy.MAILTM,
            '33mail': EmailStrategy.THIRTY_THREE_MAIL,
            'thirtythreemail': EmailStrategy.THIRTY_THREE_MAIL,
            'icloud_pool': EmailStrategy.ICLOUD_POOL,
            'icloud': EmailStrategy.ICLOUD_POOL,  # convenient alias
        }

        strategy_enum = strategy_map.get(self.email_strategy.lower())
        if not strategy_enum:
            raise ValueError(f"Unsupported email strategy: {self.email_strategy}")

        if strategy_enum == EmailStrategy.STATIC:
            # base_email not required when email is provided directly via --email / caller
            if not self.base_email:
                logger.warning("base_email not set for STATIC strategy — email must be provided by caller")
            generator = StaticEmailGenerator(self.base_email or "placeholder@unknown.com")
            self.email_strategy_instance = StaticImapStrategy(generator, verifier)

        elif strategy_enum == EmailStrategy.COUNTER:
            if not self.base_email:
                raise ValueError("base_email required for COUNTER strategy")
            generator = CounterEmailGenerator(
                self.base_email,
                template=getattr(self, 'counter_template', None),
            )
            self.email_strategy_instance = CounterImapStrategy(generator, verifier)

        elif strategy_enum in (EmailStrategy.ADDYIO, EmailStrategy.ADDYIO_COUNTER):
            if not self.addyio_config:
                raise ValueError("addyio_config required for ADDYIO strategy")
            generator = AddyIoEmailGenerator(self.addyio_config)
            self.email_strategy_instance = AddyIoImapStrategy(generator, verifier)

        elif strategy_enum == EmailStrategy.MAILTM:
            mailtm_config = MailTmConfig()
            self.email_strategy_instance = MailTmStrategy(mailtm_config)

        elif strategy_enum == EmailStrategy.THIRTY_THREE_MAIL:
            if not self.thirty_three_mail_config:
                raise ValueError("thirty_three_mail_config required for THIRTY_THREE_MAIL strategy")
            generator = ThirtyThreeMailGenerator(
                self.thirty_three_mail_config['username'],
                template=self.thirty_three_mail_config.get('template'),
            )
            self.email_strategy_instance = BaseStrategy(generator, verifier)

        elif strategy_enum == EmailStrategy.ICLOUD_POOL:
            if not self.icloud_config:
                raise ValueError("icloud_config required for ICLOUD_POOL strategy")
            from ..stitch_backend_bridge import get_icloud_pool_fetch_fn
            pool_fetch_fn = get_icloud_pool_fetch_fn()
            # Build IMAP config from icloud_config (same app-specific password)
            imap_cfg: dict | None = None
            imap_pass = getattr(self.icloud_config, 'imap_password', '') or getattr(self.icloud_config, 'app_specific_password', '')
            if imap_pass:
                imap_cfg = {
                    'host': 'imap.mail.me.com',
                    'port': 993,
                    'user': self.icloud_config.apple_id,
                    'password': imap_pass,
                }
            self.email_strategy_instance = ICloudPoolStrategy(
                pool_fetch_fn=pool_fetch_fn,
                imap_config=imap_cfg,
                label_prefix=getattr(self.icloud_config, 'label_prefix', 'Auto-registration'),
            )

        else:
            raise ValueError(f"Unsupported email strategy: {strategy_enum}")

    def set_log_callback(self, callback: Callable[[str], None]):
        """
        Set logging callback function.

        Args:
            callback: Function to call with log messages
        """
        self.log_callback = callback

    def _log(self, message: str):
        """
        Internal logging helper.

        Args:
            message: Message to log
        """
        self.log(message)

    def close(self):
        """
        Cleanup resources - closes email strategy, browser, and registration instances.

        This method safely closes email strategy, browser, and registration instances,
        catching and ignoring any exceptions during cleanup.
        """
        if self.email_strategy_instance:
            try:
                self.email_strategy_instance.close()
            except Exception:
                pass
            self.email_strategy_instance = None

        if self._registration:
            try:
                self._registration.close()
            except Exception:
                pass
            self._registration = None

        if self.browser:
            try:
                self.browser.close()
            except Exception:
                pass
            self.browser = None


__all__ = ['CommonProvider']
