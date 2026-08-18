"""
Email Manager - Unified email generation and verification.

Supports multiple strategies:
- Static: Use single email
- Counter: email+1@, email+2@
- Addy.io: Generate temporary aliases
- Addy.io + Counter: Combine both

Addy.io creates aliases that FORWARD to a real email inbox.
IMAP is still required to read the forwarded emails.
"""

from dataclasses import dataclass, field
from typing import Any

from .addyio import AddyIoConfig, AddyIoService

# Import EmailStrategy - handle both relative and absolute imports
try:
    from ..shared.models import EmailStrategy
except ImportError:
    from shared.models import EmailStrategy


@dataclass
class EmailContext:
    """Context for generated email"""

    email: str
    alias_id: str | None = None
    should_cleanup: bool = False
    metadata: dict[str, Any] | None = field(default_factory=dict)


class EmailManager:
    """Manages email generation across different strategies"""

    def __init__(
        self,
        strategy: EmailStrategy,
        base_email: str,
        addyio_config: AddyIoConfig | None = None,
        thirty_three_mail_config: dict[str, str] | None = None,
        counter: int = 0,
    ):
        """
        Initialize email manager.

        Args:
            strategy: Email generation strategy
            base_email: Base email address (for static/counter) or recipient (for addyio)
            addyio_config: Addy.io configuration (required for addyio strategies)
            thirty_three_mail_config: 33mail config {'username': '...', 'domain': '...'}
            counter: Starting counter value
        """
        self.strategy = strategy
        self.base_email = base_email
        self.counter = counter
        self.addyio_service = None
        self.thirty_three_mail_config = thirty_three_mail_config

        if strategy in [EmailStrategy.ADDYIO, EmailStrategy.ADDYIO_COUNTER]:
            if not addyio_config:
                raise ValueError("Addy.io config required for addyio strategies")
            self.addyio_service = AddyIoService(addyio_config)

    def generate_email(self, description: str | None = None) -> EmailContext:
        """
        Generate email based on strategy.

        Args:
            description: Description for the email/alias

        Returns:
            EmailContext with generated email and metadata
        """

        if self.strategy == EmailStrategy.STATIC:
            return EmailContext(email=self.base_email)

        elif self.strategy == EmailStrategy.COUNTER:
            local, domain = self.base_email.split("@", 1)
            email = f"{local}+{self.counter}@{domain}"
            self.counter += 1
            return EmailContext(email=email)

        elif self.strategy == EmailStrategy.ADDYIO:
            alias_data = self.addyio_service.create_alias(
                description=description or "Auto-registration",
                format=self.addyio_service.config.alias_format,
            )
            return EmailContext(
                email=alias_data["email"],
                alias_id=alias_data["id"],
                should_cleanup=self.addyio_service.config.auto_delete,
                metadata=alias_data,
            )

        elif self.strategy == EmailStrategy.ADDYIO_COUNTER:
            desc = f"{description} #{self.counter}" if description else f"Account #{self.counter}"
            alias_data = self.addyio_service.create_alias(
                description=desc, format=self.addyio_service.config.alias_format
            )
            self.counter += 1
            return EmailContext(
                email=alias_data["email"],
                alias_id=alias_data["id"],
                should_cleanup=False,  # Keep for tracking
                metadata=alias_data,
            )

        elif self.strategy == EmailStrategy.THIRTY_THREE_MAIL:
            if not self.thirty_three_mail_config:
                raise ValueError("33mail config required")

            username = self.thirty_three_mail_config.get("username")
            if not username:
                raise ValueError("33mail username required")

            domain = self.thirty_three_mail_config.get("domain", "33mail.com")

            # Generate random prefix or use description/counter
            import random
            import string

            prefix = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
            if description:
                # Sanitize description
                clean_desc = "".join(c for c in description if c.isalnum() or c in "-_").lower()
                prefix = f"{clean_desc}-{prefix}"

            # Format: something@username.33mail.com
            email = f"{prefix}@{username}.{domain}"

            return EmailContext(email=email, should_cleanup=False)

        else:
            raise ValueError(f"Unknown email strategy: {self.strategy}")

    def cleanup_email(self, context: EmailContext):
        """
        Cleanup email if needed (delete addy.io alias).

        Args:
            context: EmailContext from generate_email()
        """
        if context.should_cleanup and context.alias_id and self.addyio_service:
            try:
                self.addyio_service.delete_alias(context.alias_id)
                print(f"[EmailManager] Deleted alias: {context.email}")
            except Exception as e:
                print(f"[EmailManager] Failed to cleanup alias {context.alias_id}: {e}")

    def close(self):
        """Cleanup resources"""
        if self.addyio_service:
            self.addyio_service.close()


__all__ = ["EmailManager", "EmailContext"]
