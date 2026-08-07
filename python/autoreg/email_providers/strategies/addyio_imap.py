import logging
from contextlib import contextmanager

from ..generators import AddyIoEmailGenerator
from ..verifiers import ImapVerifier
from .base import BaseStrategy

logger = logging.getLogger(__name__)


class AddyIoImapStrategy(BaseStrategy):
    """Strategy using Addy.io aliases with IMAP verification"""

    def __init__(self, generator: AddyIoEmailGenerator, verifier: ImapVerifier):
        """
        Initialize Addy.io IMAP strategy

        Args:
            generator: AddyIoEmailGenerator instance
            verifier: ImapVerifier instance
        """
        super().__init__(generator, verifier)
        logger.info("Initialized AddyIoImapStrategy")

    @contextmanager
    def generate_and_verify_with_cleanup(
        self,
        description: str | None = None,
        sender_keywords: list[str] | None = None,
        max_wait: int = 120,
        session_id: str | None = None
    ):
        """
        Context manager for generate + verify + automatic cleanup

        Usage:
            with strategy.generate_and_verify_with_cleanup("GitHub", ["github"]) as (ctx, code):
                # Use ctx.email and code
                pass
            # Cleanup happens automatically

        Args:
            description: Description for email generation
            sender_keywords: Keywords to match in sender
            max_wait: Maximum seconds to wait for code
            session_id: Optional session ID for logging

        Yields:
            Tuple of (EmailContext, verification_code or None)
        """
        email_ctx, code = self.generate_and_verify(
            description=description,
            sender_keywords=sender_keywords,
            max_wait=max_wait,
            session_id=session_id
        )

        try:
            yield email_ctx, code
        finally:
            if email_ctx.should_cleanup:
                try:
                    self.generator.cleanup(email_ctx)
                except Exception as e:
                    logger.error(f"Cleanup failed: {e}")
