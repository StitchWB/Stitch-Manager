"""
Backward Compatibility Adapter for Email System

This module provides an adapter that maintains the old EmailManager API
while using the new email_providers system internally. This allows gradual
migration of existing code without breaking changes.
"""

import logging
from typing import Any

from ..shared.models import EmailStrategy
from .base import EmailContext
from .generators import (
    AddyIoEmailGenerator,
    CounterEmailGenerator,
    StaticEmailGenerator,
)
from .strategies import (
    AddyIoImapStrategy,
    CounterImapStrategy,
    MailTmStrategy,
    StaticImapStrategy,
)
from .verifiers import ImapVerifier

logger = logging.getLogger(__name__)


class LegacyEmailContext:
    """
    Legacy EmailContext for backward compatibility.

    This class mimics the old EmailContext interface that existing code expects.
    """

    def __init__(
        self,
        email: str,
        alias_id: str | None = None,
        should_cleanup: bool = False,
        metadata: dict | None = None
    ):
        """
        Initialize legacy email context.

        Args:
            email: Email address
            alias_id: Alias ID (for cleanup)
            should_cleanup: Whether cleanup is needed
            metadata: Additional metadata
        """
        self.email = email
        self.alias_id = alias_id
        self.should_cleanup = should_cleanup
        self.metadata = metadata or {}


class EmailManagerAdapter:
    """
    Adapter for old EmailManager API.

    This adapter provides the old EmailManager interface while using the new
    email_providers system internally. This allows existing code to continue
    working without modifications while benefiting from the new architecture.

    Example:
        >>> # Old code using EmailManager
        >>> manager = EmailManagerAdapter(
        ...     strategy=EmailStrategy.COUNTER,
        ...     base_email="test@example.com",
        ...     imap_config={"host": "imap.gmail.com", ...}
        ... )
        >>> ctx = manager.generate_email("GitHub registration")
        >>> print(ctx.email)  # test+1@example.com
        >>> manager.cleanup_email(ctx)
    """

    def __init__(
        self,
        strategy: EmailStrategy,
        base_email: str,
        imap_config: dict | None = None,
        addyio_config: Any = None,
        counter: int = 0
    ):
        """
        Initialize adapter with old EmailManager parameters.

        Args:
            strategy: EmailStrategy enum (STATIC, COUNTER, ADDYIO)
            base_email: Base email address
            imap_config: IMAP configuration dict
            addyio_config: Addy.io configuration
            counter: Starting counter for COUNTER strategy
        """
        self.strategy_type = strategy
        self.base_email = base_email
        self.counter = counter

        # Create verifier if IMAP config provided
        verifier = ImapVerifier(imap_config) if imap_config else None

        # Create strategy based on type
        if strategy == EmailStrategy.STATIC:
            generator = StaticEmailGenerator(base_email)
            self.strategy = StaticImapStrategy(generator, verifier) if verifier else None
            self.generator = generator

        elif strategy == EmailStrategy.COUNTER:
            generator = CounterEmailGenerator(base_email, start=counter)
            self.strategy = CounterImapStrategy(generator, verifier) if verifier else None
            self.generator = generator

        elif strategy == EmailStrategy.ADDYIO:
            if not addyio_config:
                raise ValueError("addyio_config required for ADDYIO strategy")
            generator = AddyIoEmailGenerator(addyio_config)
            self.strategy = AddyIoImapStrategy(generator, verifier) if verifier else None
            self.generator = generator

        elif strategy == EmailStrategy.MAILTM:
            # Mail.tm doesn't need base_email or config
            from ...services.mailtm import MailTmConfig
            mailtm_config = MailTmConfig()
            self.strategy = MailTmStrategy(mailtm_config)
            self.generator = self.strategy.generator

        else:
            raise ValueError(f"Unsupported strategy: {strategy}")

        logger.info(f"EmailManagerAdapter initialized with {strategy} strategy")

    def generate_email(self, description: str | None = None) -> LegacyEmailContext:
        """
        Generate email using old API.

        Args:
            description: Optional description for the email

        Returns:
            LegacyEmailContext with generated email
        """
        new_ctx = self.generator.generate(description)

        # Convert to legacy format
        return LegacyEmailContext(
            email=new_ctx.email,
            alias_id=new_ctx.alias_id,
            should_cleanup=new_ctx.should_cleanup,
            metadata=new_ctx.metadata
        )

    def cleanup_email(self, context: LegacyEmailContext):
        """
        Cleanup email using old API.

        Args:
            context: LegacyEmailContext to cleanup
        """
        # Convert to new format
        new_ctx = EmailContext(
            email=context.email,
            alias_id=context.alias_id,
            should_cleanup=context.should_cleanup,
            metadata=context.metadata
        )

        self.generator.cleanup(new_ctx)

    def close(self):
        """Close resources"""
        if self.strategy:
            self.strategy.close()
        else:
            self.generator.close()


__all__ = ['EmailManagerAdapter', 'LegacyEmailContext']
