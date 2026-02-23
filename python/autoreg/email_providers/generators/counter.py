"""Counter-based email generator with thread-safe incrementing"""
import logging
import threading
from ..base import IEmailGenerator, EmailContext

logger = logging.getLogger(__name__)


class CounterEmailGenerator(IEmailGenerator):
    """Generator that appends incrementing counter to email"""
    
    def __init__(self, base_email: str, start: int = 0):
        """
        Initialize counter generator
        
        Args:
            base_email: Base email (e.g., "user@gmail.com")
            start: Starting counter value
            
        Raises:
            ValueError: If base email format is invalid
        """
        self.base_email = base_email
        self.counter = start
        self.lock = threading.Lock()
        
        # Validate base email format
        if '@' not in base_email:
            raise ValueError(f"Invalid base email: {base_email}")
        
        # Split email into local and domain parts
        local, domain = base_email.rsplit('@', 1)
        self.local_part = local
        self.domain = domain
    
    def generate(self, description: str | None = None) -> EmailContext:
        """
        Generate email with counter
        
        Args:
            description: Optional description
            
        Returns:
            EmailContext with counter-based email (e.g., user+0@gmail.com)
        """
        with self.lock:
            current = self.counter
            self.counter += 1
        
        email = f"{self.local_part}+{current}@{self.domain}"
        logger.info(f"Generated counter email: {email}")
        
        return EmailContext(
            email=email,
            alias_id=None,
            should_cleanup=False,
            metadata={
                'type': 'counter',
                'counter': current,
                'description': description
            }
        )
    
    def cleanup(self, context: EmailContext) -> None:
        """No cleanup needed for counter email"""
        logger.debug(f"No cleanup needed for counter email: {context.email}")
