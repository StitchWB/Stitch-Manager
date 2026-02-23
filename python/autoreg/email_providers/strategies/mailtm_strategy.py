"""Mail.tm email strategy"""
import logging
from ..base import IEmailStrategy, EmailContext
from ..generators.mailtm import MailTmEmailGenerator
from ..verifiers.mailtm_verifier import MailTmVerifier
from ...services.mailtm import MailTmConfig

logger = logging.getLogger(__name__)


class MailTmStrategy(IEmailStrategy):
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
        self.generator = MailTmEmailGenerator(self.config)
        self.verifier = MailTmVerifier(self.config)
    
    def generate_and_verify(
        self,
        description: str | None = None,
        sender_keywords: list[str] | None = None,
        max_wait: int = 120,
        session_id: str | None = None
    ) -> tuple[EmailContext, str | None]:
        """
        Generate Mail.tm email and get verification code
        
        Args:
            description: Optional description for the email
            sender_keywords: Keywords to match in sender (required for verification)
            max_wait: Maximum seconds to wait for verification email
            session_id: Optional session identifier for logging
            
        Returns:
            Tuple of (EmailContext, verification_code or None)
        """
        log_prefix = f"[{session_id}]" if session_id else ""
        
        # Generate email
        logger.info(f"{log_prefix} Generating Mail.tm email")
        context = self.generator.generate(description)
        
        # If no sender keywords, return without verification
        if not sender_keywords:
            logger.info(
                f"{log_prefix} No sender keywords provided, "
                "skipping verification"
            )
            return context, None
        
        # Get verification code
        logger.info(
            f"{log_prefix} Waiting for verification email "
            f"from {sender_keywords}"
        )
        code = self.verifier.verify(
            context=context,
            sender_keywords=sender_keywords,
            max_wait=max_wait,
            session_id=session_id
        )
        
        if code:
            logger.info(f"{log_prefix} Verification successful: {code}")
        else:
            logger.warning(f"{log_prefix} No verification code received")
        
        return context, code
    
    def close(self):
        """Close resources"""
        self.generator.close()
        self.verifier.close()
