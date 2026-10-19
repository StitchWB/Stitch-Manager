"""
Base interfaces for email provider system.

Defines core abstractions for email generation, verification, and strategies.
"""

from __future__ import annotations

import logging
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class EmailContext:
    """
    Context for generated email with metadata.

    Attributes:
        email: The generated email address
        alias_id: Optional alias identifier for cleanup
        should_cleanup: Whether this email should be cleaned up after use
        metadata: Additional provider-specific metadata
    """
    email: str
    alias_id: str | None = None
    should_cleanup: bool = False
    metadata: dict | None = None

    def __post_init__(self):
        """Validate email after creation."""
        if not self.email:
            raise ValueError("Email cannot be empty")

        if len(self.email) > 254:
            raise ValueError(f"Email too long: {len(self.email)} > 254 characters")

        # RFC 5322 simplified email validation
        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(pattern, self.email):
            raise ValueError(f"Invalid email format: {self.email}")

        logger.debug(f"Created EmailContext: {self.email}")


class IEmailGenerator(ABC):
    """
    Interface for email generation.

    Implementations handle creating email addresses through various providers
    (e.g., Addy.io, SimpleLogin, temp mail services).
    """

    @abstractmethod
    def generate(self, description: str | None = None) -> EmailContext:
        """
        Generate a new email address.

        Args:
            description: Optional description for the email/alias

        Returns:
            EmailContext with generated email and metadata

        Raises:
            Exception: If generation fails
        """
        pass

    @abstractmethod
    def cleanup(self, context: EmailContext) -> None:
        """
        Cleanup generated email resources.

        For alias services, this deletes the alias.
        For temp mail, this may be a no-op.

        Args:
            context: The EmailContext to cleanup

        Raises:
            Exception: If cleanup fails
        """
        pass

    def close(self) -> None:  # noqa: B027 — intentional no-op default
        """
        Close any resources (connections, sessions, etc.).

        Called when the generator is no longer needed.
        """


class IEmailVerifier(ABC):
    """
    Interface for email verification.

    Implementations handle retrieving verification codes from email inboxes
    through various providers (e.g., Addy.io, SimpleLogin, IMAP).
    """

    @abstractmethod
    def get_verification_code(
        self,
        target_email: str,
        sender_keywords: list[str],
        max_wait: int = 120,
        session_id: str | None = None
    ) -> str | None:
        """
        Get verification code from email.

        Polls the email inbox for messages matching sender keywords,
        extracts verification code from message content.

        Args:
            target_email: Email address to check
            sender_keywords: Keywords to match in sender address/name
            max_wait: Maximum seconds to wait for email
            session_id: Optional session identifier for logging

        Returns:
            Verification code if found, None otherwise

        Raises:
            Exception: If verification check fails
        """
        pass

    def close(self) -> None:  # noqa: B027 — intentional no-op default
        """
        Close any resources (connections, sessions, etc.).

        Called when the verifier is no longer needed.
        """
        pass


class IEmailStrategy(ABC):
    """
    Interface for email strategy.

    Combines email generation and verification into a cohesive strategy.
    Implementations coordinate between generator and verifier.
    """

    @abstractmethod
    def generate_and_verify(
        self,
        description: str | None = None,
        sender_keywords: list[str] | None = None
    ) -> tuple[EmailContext, str | None]:
        """
        Generate email and optionally verify.

        Args:
            description: Optional description for the email/alias
            sender_keywords: Optional keywords for verification

        Returns:
            Tuple of (EmailContext, verification_code or None)

        Raises:
            Exception: If generation or verification fails
        """
        pass
