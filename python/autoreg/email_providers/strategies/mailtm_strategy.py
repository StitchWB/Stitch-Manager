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
        session_id: str | None = None,
        url_pattern: str | None = None,
    ) -> tuple[EmailContext, str | None]:
        """
        Generate Mail.tm email and get verification code or URL
        
        Args:
            description: Optional description for the email
            sender_keywords: Keywords to match in sender (required for verification)
            max_wait: Maximum seconds to wait for verification email
            session_id: Optional session identifier for logging
            url_pattern: Regex pattern to extract a URL instead of a code.
                         If provided, returns the first URL matching this pattern.
            
        Returns:
            Tuple of (EmailContext, verification_code/url or None)
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
        
        # Get verification code or URL
        logger.info(
            f"{log_prefix} Waiting for verification email "
            f"from {sender_keywords}"
        )
        result = self.verifier.verify(
            context=context,
            sender_keywords=sender_keywords,
            max_wait=max_wait,
            session_id=session_id,
            url_pattern=url_pattern,
        )
        
        if result:
            logger.info(f"{log_prefix} Verification successful: {'URL' if url_pattern else 'code'} found")
        else:
            logger.warning(f"{log_prefix} No verification {'URL' if url_pattern else 'code'} received")
        
        return context, result
    
    def close(self):
        """Close resources"""
        self.generator.close()
        self.verifier.close()
