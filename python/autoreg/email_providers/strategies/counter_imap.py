import logging

from ..generators import CounterEmailGenerator
from ..verifiers import ImapVerifier
from .base import BaseStrategy

logger = logging.getLogger(__name__)


class CounterImapStrategy(BaseStrategy):
    """Strategy using counter email with IMAP verification"""

    def __init__(self, generator: CounterEmailGenerator, verifier: ImapVerifier):
        """
        Initialize counter IMAP strategy

        Args:
            generator: CounterEmailGenerator instance
            verifier: ImapVerifier instance
        """
        super().__init__(generator, verifier)
        logger.info(f"Initialized CounterImapStrategy with base: {generator.base_email}")
