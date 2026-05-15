"""Addy.io email alias generator with retry and rate limiting"""
import logging
from contextlib import contextmanager
from ..base import IEmailGenerator, EmailContext
from ..utils.retry import retry_with_backoff
from ..utils.rate_limiter import handle_rate_limit
from ...services.addyio import AddyIoService, AddyIoConfig
from .template_utils import render_template, TemplateState

logger = logging.getLogger(__name__)


class AddyIoEmailGenerator(IEmailGenerator):
    """Generator that creates Addy.io aliases with optional template support."""
    
    def __init__(self, addyio_config: AddyIoConfig):
        """
        Initialize Addy.io generator
        
        Args:
            addyio_config: AddyIoConfig object with api_token, base_url, etc.
        """
        self.config = addyio_config
        self.service = AddyIoService(addyio_config)
        self._template = getattr(addyio_config, 'template', None)
        self._state = TemplateState()
    
    @handle_rate_limit(max_retries=3)
    def _create_alias_with_retry(self, description: str) -> dict:
        """
        Create alias with rate limiting and retry
        
        Args:
            description: Description for the alias
            
        Returns:
            Alias data dict with 'email', 'id', etc.
            
        Raises:
            requests.HTTPError: If API request fails
            RateLimitError: If rate limit persists
        """
        return retry_with_backoff(
            func=lambda: self.service.create_alias(
                description=description,
                format=self.config.alias_format
            ),
            max_retries=3,
            initial_delay=1.0
        )
    
    def generate(self, description: str | None = None) -> EmailContext:
        """
        Generate Addy.io alias
        
        Args:
            description: Optional description for the alias (supports templates)
            
        Returns:
            EmailContext with Addy.io alias
            
        Raises:
            requests.HTTPError: If API request fails
            RateLimitError: If rate limit persists
        """
        if self._template:
            desc = render_template(
                self._template,
                state=self._state,
                description=description,
            )
        else:
            desc = description or "Auto-registration"
        
        logger.info(f"Creating Addy.io alias: {desc}")
        
        try:
            alias_data = self._create_alias_with_retry(desc)
            
            logger.info(f"Created Addy.io alias: {alias_data['email']}")
            
            return EmailContext(
                email=alias_data['email'],
                alias_id=alias_data['id'],
                should_cleanup=self.config.auto_delete,
                metadata={
                    'type': 'addyio',
                    'description': desc,
                    'template': self._template,
                    'alias_data': alias_data
                }
             
            )
        except Exception as e:
            logger.error(f"Failed to create Addy.io alias: {e}")
            raise
    
    def cleanup(self, context: EmailContext) -> None:
        """
        Delete Addy.io alias
        
        Args:
            context: EmailContext with alias_id
            
        Raises:
            requests.HTTPError: If API request fails
        """
        if not context.alias_id:
            logger.warning(f"No alias_id to cleanup for {context.email}")
            return
        
        try:
            logger.info(f"Deleting Addy.io alias: {context.email}")
            self.service.delete_alias(context.alias_id)
            logger.info(f"Deleted Addy.io alias: {context.email}")
        except Exception as e:
            logger.error(f"Failed to delete Addy.io alias {context.email}: {e}")
            raise
    
    @contextmanager
    def generate_with_cleanup(self, description: str | None = None):
        """
        Context manager for automatic cleanup
        
        Usage:
            with generator.generate_with_cleanup("GitHub") as email_ctx:
                # Use email_ctx.email
                pass
            # Cleanup happens automatically
            
        Args:
            description: Description for the alias
            
        Yields:
            EmailContext with Addy.io alias
        """
        context = self.generate(description)
        try:
            yield context
        finally:
            if context.should_cleanup:
                try:
                    self.cleanup(context)
                except Exception as e:
                    logger.error(f"Cleanup failed: {e}")
