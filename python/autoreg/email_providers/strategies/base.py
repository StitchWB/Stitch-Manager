import logging
from abc import ABC

from ..base import EmailContext, IEmailGenerator, IEmailStrategy, IEmailVerifier

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
        session_id: str | None = None,
        url_pattern: str | None = None,
    ) -> tuple[EmailContext, str | None]:
        """
        Generate email and optionally verify

        Args:
            description: Description for email generation
            sender_keywords: Keywords to match in sender (for verification)
            max_wait: Maximum seconds to wait for verification code
            session_id: Optional session ID for logging
            url_pattern: Regex pattern to extract URL instead of code (e.g. for Fireworks)

        Returns:
            Tuple of (EmailContext, verification_code or URL or None)
        """
        # Generate email
        email_ctx = self.generator.generate(description)

        result = None
        if self.verifier and sender_keywords:
            # If url_pattern provided, try to get confirmation URL
            if url_pattern and hasattr(self.verifier, 'get_confirmation_url'):
                result = self.verifier.get_confirmation_url(
                    target_email=email_ctx.email,
                    sender_keywords=sender_keywords,
                    url_pattern=url_pattern,
                    max_wait=max_wait,
                    session_id=session_id,
                )
            # Fallback to verification code
            if result is None:
                result = self.verifier.get_verification_code(
                    target_email=email_ctx.email,
                    sender_keywords=sender_keywords,
                    max_wait=max_wait,
                    session_id=session_id,
                )

        return email_ctx, result

    def verify(
        self,
        context: EmailContext,
        sender_keywords: list[str],
        max_wait: int = 120,
        session_id: str | None = None,
        url_pattern: str | None = None,
    ) -> str | None:
        """
        Verify email after generation (wait for incoming email).

        Args:
            context: EmailContext from generate()
            sender_keywords: Keywords to match in sender
            max_wait: Maximum seconds to wait
            session_id: Optional session ID for logging
            url_pattern: Regex pattern to extract URL instead of code

        Returns:
            Verification code or URL or None
        """
        if not self.verifier:
            return None

        # Try direct verify() first (useful for Mail.tm which needs context)
        if hasattr(self.verifier, 'verify'):
            try:
                return self.verifier.verify(
                    context=context,
                    sender_keywords=sender_keywords,
                    max_wait=max_wait,
                    session_id=session_id,
                    url_pattern=url_pattern,
                )
            except TypeError:
                # If verify doesn't take context as first arg, fallback
                pass

        # If url_pattern provided and verifier supports it, get URL
        if url_pattern and hasattr(self.verifier, 'get_confirmation_url'):
            return self.verifier.get_confirmation_url(
                target_email=context.email,
                sender_keywords=sender_keywords,
                url_pattern=url_pattern,
                max_wait=max_wait,
                session_id=session_id,
            )

        # Otherwise get verification code
        return self.verifier.get_verification_code(
            target_email=context.email,
            sender_keywords=sender_keywords,
            max_wait=max_wait,
            session_id=session_id,
        )

    def close(self):
        """Close resources"""
        self.generator.close()
        if self.verifier:
            self.verifier.close()
