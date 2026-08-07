import logging

from ..generators import StaticEmailGenerator
from ..verifiers import ImapVerifier
from .base import BaseStrategy

logger = logging.getLogger(__name__)


class StaticImapStrategy(BaseStrategy):
    """Strategy using static email with IMAP verification"""

    def __init__(self, generator: StaticEmailGenerator, verifier: ImapVerifier):
        """
        Initialize static IMAP strategy

        Args:
            generator: StaticEmailGenerator instance
            verifier: ImapVerifier instance
        """
        super().__init__(generator, verifier)
        logger.info(f"Initialized StaticImapStrategy with email: {generator.email}")
