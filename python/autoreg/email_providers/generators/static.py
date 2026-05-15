"""Static email generator that returns the same email every time"""
import logging
from ..base import IEmailGenerator, EmailContext

logger = logging.getLogger(__name__)


class StaticEmailGenerator(IEmailGenerator):
    """Generator that returns the same email every time."""
    
    def __init__(self, email: str):
        """
        Initialize static generator
        
        Args:
            email: Email address to use
            
        Raises:
            ValueError: If email format is invalid
        """
        self.email = email
        # Validate email on initialization
        EmailContext(email=email)  # Will raise if invalid
    
    def generate(self, description: str | None = None) -> EmailContext:
        """
        Generate static email
        
        Args:
            description: Optional description (not used)
            
        Returns:
            EmailContext with static email
        """
        logger.info(f"Generating static email: {self.email}")
        return EmailContext(
            email=self.email,
            alias_id=None,
            should_cleanup=False,
            metadata={'type': 'static', 'description': description}
        )
    
    def cleanup(self, context: EmailContext) -> None:
        """No cleanup needed for static email"""
        logger.debug(f"No cleanup needed for static email: {context.email}")
