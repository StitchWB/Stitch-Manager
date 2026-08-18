"""Mail.tm email strategy"""
import logging

from ...services.mailtm import MailTmConfig
from ..generators.mailtm import MailTmEmailGenerator
from ..verifiers.mailtm_verifier import MailTmVerifier

logger = logging.getLogger(__name__)


from .base import BaseStrategy

logger = logging.getLogger(__name__)


class MailTmStrategy(BaseStrategy):
    """
    Strategy for Mail.tm temporary emails with verification

    This strategy combines Mail.tm email generation and verification
    into a single workflow.
    """

    def __init__(self, config: MailTmConfig | None = None):
        """
        Initialize Mail.tm strategy

        Args:
            config: MailTmConfig object (uses defaults if None)
        """
        self.config = config or MailTmConfig()
        super().__init__(
            generator=MailTmEmailGenerator(self.config),
            verifier=MailTmVerifier(self.config)
        )

    # BaseStrategy provides generate_and_verify and verify implementations

    def close(self):
        """Close resources"""
        self.generator.close()
        self.verifier.close()
