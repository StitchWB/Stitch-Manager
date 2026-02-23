"""33mail.com email generator"""
import logging
import random
import string
from ..base import IEmailGenerator, EmailContext

logger = logging.getLogger(__name__)


class ThirtyThreeMailGenerator(IEmailGenerator):
    """Generator for 33mail.com addresses"""
    
    def __init__(self, username: str):
        """
        Initialize 33mail generator
        
        Args:
            username: 33mail username (e.g., "myusername")
        """
        self.username = username
        self.domain = f"{username}.33mail.com"
    
    def _generate_random_prefix(self, length: int = 8) -> str:
        """Generate random alphanumeric prefix"""
        return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))
    
    def generate(self, description: str | None = None) -> EmailContext:
        """
        Generate 33mail address
        
        Args:
            description: Optional description (used as prefix if provided)
            
        Returns:
            EmailContext with 33mail address
        """
        # Use description as prefix if provided, otherwise random
        if description:
            # Sanitize description for email
            clean_desc = description.lower().replace(' ', '-')[:20]
            # Add random suffix to make each email unique
            random_suffix = self._generate_random_prefix(length=8)
            prefix = f"{clean_desc}-{random_suffix}"
        else:
            prefix = self._generate_random_prefix()
        
        email = f"{prefix}@{self.domain}"
        
        # Validate length (33mail has limits)
        if len(email) > 254:
            # Truncate prefix if too long
            max_prefix_len = 254 - len(self.domain) - 1
            prefix = prefix[:max_prefix_len]
            email = f"{prefix}@{self.domain}"
        
        logger.info(f"Generated 33mail address: {email}")
        
        return EmailContext(
            email=email,
            alias_id=None,
            should_cleanup=False,
            metadata={
                'type': '33mail',
                'prefix': prefix,
                'description': description
            }
        )
    
    def cleanup(self, context: EmailContext) -> None:
        """No cleanup needed for 33mail (auto-forwards)"""
        logger.debug(f"No cleanup needed for 33mail: {context.email}")
