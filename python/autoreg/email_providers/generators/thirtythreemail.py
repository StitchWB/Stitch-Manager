"""33mail.com email generator with template support"""
import logging
import random
import string

from ..base import EmailContext, IEmailGenerator
from .template_utils import TemplateState, render_template

logger = logging.getLogger(__name__)


class ThirtyThreeMailGenerator(IEmailGenerator):
    """Generator for 33mail.com addresses with template support."""

    def __init__(
        self,
        username: str,
        template: str | None = None,
    ):
        """
        Initialize 33mail generator

        Args:
            username: 33mail username (e.g., "myusername")
            template: Optional template for local part (default "{rnd12}")
                Supported: {rndN}, {counter}, {time}, {name}, {uuid4}, {uuid4_8}
        """
        self.username = username
        self.domain = f"{username}.33mail.com"
        self.template = template or "{rnd12}"
        self._state = TemplateState()

    def _generate_random_prefix(self, length: int = 8) -> str:
        """Generate random alphanumeric prefix"""
        return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))

    def generate(self, description: str | None = None) -> EmailContext:
        """
        Generate 33mail address

        Args:
            description: Optional description (used by {name} placeholder)

        Returns:
            EmailContext with 33mail address
        """
        prefix = render_template(
            self.template,
            state=self._state,
            description=description,
        )

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
                'template': self.template,
                'description': description,
            }
        )

    def cleanup(self, context: EmailContext) -> None:
        """No cleanup needed for 33mail (auto-forwards)"""
        logger.debug(f"No cleanup needed for 33mail: {context.email}")
