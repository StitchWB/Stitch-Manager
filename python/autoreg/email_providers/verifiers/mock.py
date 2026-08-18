"""Mock verifier for testing"""

import logging
import time

from ..base import IEmailVerifier

logger = logging.getLogger(__name__)


class MockVerifier(IEmailVerifier):
    """Mock verifier for testing"""

    def __init__(
        self,
        code: str = "123456",
        delay: float = 0.0,
        should_fail: bool = False
    ):
        """
        Initialize mock verifier

        Args:
            code: Code to return
            delay: Simulated delay in seconds
            should_fail: If True, returns None (simulates failure)
        """
        self.code = code
        self.delay = delay
        self.should_fail = should_fail

    def get_verification_code(
        self,
        target_email: str,
        sender_keywords: list[str],
        max_wait: int = 120,
        session_id: str | None = None
    ) -> str | None:
        """Return mock verification code"""
        session_prefix = f"[{session_id}] " if session_id else ""
        logger.info(f"{session_prefix}MockVerifier: Getting code for {target_email}")

        if self.delay > 0:
            time.sleep(self.delay)

        if self.should_fail:
            logger.warning(f"{session_prefix}MockVerifier: Simulating failure")
            return None

        logger.info(f"{session_prefix}MockVerifier: Returning code {self.code}")
        return self.code
