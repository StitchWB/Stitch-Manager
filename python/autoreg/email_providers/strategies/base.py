import logging
from abc import ABC
from ..base import IEmailStrategy, IEmailGenerator, IEmailVerifier, EmailContext

logger = logging.getLogger(__name__)


class BaseStrategy(IEmailStrategy, ABC):
    """Base strategy combining generator and verifier"""
    
    def __init__(
        self,
        generator: IEmailGenerator,
        verifier: IEmailVerifier | None = None
    ):
        """
        Initialize strategy
        
        Args:
            generator: Email generator
            verifier: Optional email verifier (for getting codes)
        """
        self.generator = generator
        self.verifier = verifier
    
    def generate_and_verify(
        self,
        description: str | None = None,
        sender_keywords: list[str] | None = None,
        max_wait: int = 120,
        session_id: str | None = None
    ) -> tuple[EmailContext, str | None]:
        """
        Generate email and optionally verify
        
        Args:
            description: Description for email generation
            sender_keywords: Keywords to match in sender (for verification)
            max_wait: Maximum seconds to wait for verification code
            session_id: Optional session ID for logging
            
        Returns:
            Tuple of (EmailContext, verification_code or None)
        """
        # Generate email
        email_ctx = self.generator.generate(description)
        
        # Get verification code if verifier provided
        code = None
        if self.verifier and sender_keywords:
            code = self.verifier.get_verification_code(
                target_email=email_ctx.email,
                sender_keywords=sender_keywords,
                max_wait=max_wait,
                session_id=session_id
            )
        
        return email_ctx, code
    
    def close(self):
        """Close resources"""
        self.generator.close()
        if self.verifier:
            self.verifier.close()
