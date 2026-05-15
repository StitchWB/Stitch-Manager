"""Counter-based email generator with thread-safe incrementing and template support"""
import logging
import threading
from ..base import IEmailGenerator, EmailContext
from .template_utils import render_template, TemplateState

logger = logging.getLogger(__name__)


class CounterEmailGenerator(IEmailGenerator):
    """Generator that appends incrementing counter to email with optional template."""
    
    def __init__(self, base_email: str, start: int = 0, template: str | None = None):
        """
        Initialize counter generator
        
        Args:
            base_email: Base email (e.g., "user@gmail.com")
            start: Starting counter value
            template: Optional template for local part (default uses +counter)
            
        Raises:
            ValueError: If base email format is invalid
        """
        self.base_email = base_email
        self.counter = start
        self.lock = threading.Lock()
        self.template = template
        self._state = TemplateState(start_counter=start)
        
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
        if self.template:
            prefix = render_template(
                self.template,
                state=self._state,
                description=description,
            )
            email = f"{prefix}@{self.domain}"
        else:
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
                'template': self.template,
                'description': description
            }
        )
    
    def cleanup(self, context: EmailContext) -> None:
        """No cleanup needed for counter email"""
        logger.debug(f"No cleanup needed for counter email: {context.email}")
