"""Mail.tm temporary email generator"""
import logging
import random
import string
from contextlib import contextmanager

from ...services.mailtm import MailTmConfig, MailTmService
from ..base import EmailContext, IEmailGenerator
from ..utils.retry import retry_with_backoff

logger = logging.getLogger(__name__)


class MailTmEmailGenerator(IEmailGenerator):
    """Generator that creates Mail.tm temporary emails"""

    def __init__(self, config: MailTmConfig | None = None):
        """
        Initialize Mail.tm generator

        Args:
            config: MailTmConfig object (uses defaults if None)
        """
        self.config = config or MailTmConfig()
        self.service = MailTmService(self.config)
        self._cached_domains = None

    def _get_random_domain(self) -> str:
        """
        Get random available domain

        Returns:
            Domain string (e.g., "example.com")
        """
        if not self._cached_domains:
            domains = retry_with_backoff(
                func=lambda: self.service.get_domains(),
                max_retries=3,
                initial_delay=1.0
            )
            # Handle both dict and string formats
            self._cached_domains = []
            for d in domains:
                if isinstance(d, dict):
                    # Dict format: {"id": "...", "domain": "..."}
                    domain = d.get('domain')
                    if domain:
                        self._cached_domains.append(domain)
                elif isinstance(d, str):
                    # String format: just the domain name
                    self._cached_domains.append(d)

            if not self._cached_domains:
                raise ValueError(f"No valid domains found in response: {domains}")

        return random.choice(self._cached_domains)

    def _generate_username(self, length: int = 10) -> str:
        """
        Generate random username

        Args:
            length: Username length

        Returns:
            Random username string
        """
        chars = string.ascii_lowercase + string.digits
        return ''.join(random.choices(chars, k=length))

    def generate(self, description: str | None = None) -> EmailContext:
        """
        Generate Mail.tm temporary email

        Args:
            description: Optional description (not used by Mail.tm)

        Returns:
            EmailContext with Mail.tm email

        Raises:
            requests.HTTPError: If API request fails
        """
        logger.info("Creating Mail.tm temporary email")

        try:
            # Get random domain
            domain = self._get_random_domain()

            # Generate random username
            username = self._generate_username()
            email = f"{username}@{domain}"

            # Generate random password
            password = ''.join(random.choices(
                string.ascii_letters + string.digits,
                k=16
            ))

            # Create account
            account = retry_with_backoff(
                func=lambda: self.service.create_account(email, password),
                max_retries=3,
                initial_delay=1.0
            )

            # Login to get token
            retry_with_backoff(
                func=lambda: self.service.login(email, password),
                max_retries=3,
                initial_delay=1.0
            )

            logger.info(f"Created Mail.tm email: {email}")

            return EmailContext(
                email=email,
                alias_id=account['id'],
                should_cleanup=True,  # Always cleanup temp emails
                metadata={
                    'type': 'mailtm',
                    'password': password,
                    'account_id': account['id'],
                    'description': description or 'Temporary email'
                }
            )
        except Exception as e:
            logger.error(f"Failed to create Mail.tm email: {e}")
            raise

    def cleanup(self, context: EmailContext) -> None:
        """
        Delete Mail.tm account

        Args:
            context: EmailContext with account_id

        Raises:
            requests.HTTPError: If API request fails
        """
        if not context.alias_id:
            logger.warning(f"No account_id to cleanup for {context.email}")
            return

        try:
            logger.info(f"Deleting Mail.tm account: {context.email}")
            self.service.delete_account(context.alias_id)
            logger.info(f"Deleted Mail.tm account: {context.email}")
        except Exception as e:
            logger.error(f"Failed to delete Mail.tm account {context.email}: {e}")
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
            description: Optional description

        Yields:
            EmailContext with Mail.tm email
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

    def close(self) -> None:
        """Close service resources"""
        self.service.close()
