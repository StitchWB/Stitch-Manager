import logging

from ..base import EmailContext, IEmailGenerator, IEmailVerifier
from .base import BaseStrategy

logger = logging.getLogger(__name__)


class CustomStrategy(BaseStrategy):
    """Custom strategy with fallback generator"""

    def __init__(
        self,
        primary_generator: IEmailGenerator,
        fallback_generator: IEmailGenerator,
        verifier: IEmailVerifier
    ):
        """
        Initialize custom strategy with fallback

        Args:
            primary_generator: Primary email generator
            fallback_generator: Fallback generator if primary fails
            verifier: Email verifier
        """
        super().__init__(primary_generator, verifier)
        self.fallback_generator = fallback_generator
        logger.info("Initialized CustomStrategy with fallback")

    def generate_and_verify(
        self,
        description: str | None = None,
        sender_keywords: list[str] | None = None,
        max_wait: int = 120,
        session_id: str | None = None
    ) -> tuple[EmailContext, str | None]:
        """
        Generate and verify with fallback on failure

        Args:
            description: Description for email generation
            sender_keywords: Keywords to match in sender
            max_wait: Maximum seconds to wait for code
            session_id: Optional session ID for logging

        Returns:
            Tuple of (EmailContext, verification_code or None)
        """
        # Try primary generator
        try:
            logger.info(f"[{session_id}] Trying primary generator")
            email_ctx = self.generator.generate(description)

            # Get verification code if requested
            code = None
            if self.verifier and sender_keywords:
                code = self.verifier.get_verification_code(
                    target_email=email_ctx.email,
                    sender_keywords=sender_keywords,
                    max_wait=max_wait,
                    session_id=session_id
                )

                # Only fallback if verification was requested but failed
                if code is None:
                    raise Exception("Failed to get verification code")

            return email_ctx, code

        except Exception as e:
            logger.warning(f"[{session_id}] Primary generator failed: {e}, trying fallback")

            # Fallback to secondary generator
            email_ctx = self.fallback_generator.generate(description)

            code = None
            if self.verifier and sender_keywords:
                code = self.verifier.get_verification_code(
                    target_email=email_ctx.email,
                    sender_keywords=sender_keywords,
                    max_wait=max_wait,
                    session_id=session_id
                )

            return email_ctx, code

    def close(self):
        """Close all resources"""
        super().close()
        self.fallback_generator.close()
