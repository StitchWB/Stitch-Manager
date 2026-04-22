"""IMAP-based email verifier with connection pooling"""

import logging
from typing import Dict, Any, Optional
from ..base import IEmailVerifier
from .imap_pool import ImapConnectionPool
from ...shared.email_verification import get_verification_code_from_imap

logger = logging.getLogger(__name__)


class ImapVerifier(IEmailVerifier):
    """IMAP-based email verifier with connection pooling"""

    def __init__(self, imap_config: Dict[str, Any], pool_size: int = 3):
        """
        Initialize IMAP verifier

        Args:
            imap_config: Dict with keys: host, port, user, password
            pool_size: Size of connection pool
        """
        self.config = imap_config
        # Lazy-initialize pool so startup IMAP errors don't abort registration
        self._pool: Optional[ImapConnectionPool] = None
        self._pool_size = pool_size

    @property
    def pool(self) -> ImapConnectionPool:
        """Lazy-initialize IMAP connection pool on first use"""
        if self._pool is None:
            self._pool = ImapConnectionPool(self.config, self._pool_size)
        return self._pool

    def get_verification_code(
        self,
        target_email: str,
        sender_keywords: list,
        max_wait: int = 120,
        session_id: Optional[str] = None,
    ) -> Optional[str]:
        """
        Get 6-digit verification code from IMAP inbox.

        Args:
            target_email: Email address to filter by
            sender_keywords: Keywords to match in sender (e.g., ['github', 'noreply'])
            max_wait: Maximum seconds to wait for code
            session_id: Optional session ID for logging

        Returns:
            Verification code (6 digits) or None if not found
        """
        session_prefix = f"[{session_id}] " if session_id else ""
        logger.info(f"{session_prefix}Waiting for verification code for {target_email}")

        code = get_verification_code_from_imap(
            imap_config=self.config,
            sender_keywords=sender_keywords,
            target_email=target_email,
            max_wait=max_wait,
            session_id=session_id,
            log_callback=lambda msg: logger.info(f"{session_prefix}{msg}"),
        )

        if code:
            logger.info(f"{session_prefix}Got verification code: {code}")
        else:
            logger.warning(f"{session_prefix}Failed to get verification code")

        return code

    def get_confirmation_url(
        self,
        target_email: str,
        sender_keywords: list,
        url_pattern: str,
        max_wait: int = 120,
        session_id: Optional[str] = None,
    ) -> Optional[str]:
        """
        Get confirmation URL from IMAP inbox (for email-link-based verification like Fireworks).

        Args:
            target_email: Email address to filter by
            sender_keywords: Keywords to match in sender
            url_pattern: Regex pattern to extract URL from email body
            max_wait: Maximum seconds to wait
            session_id: Optional session ID for logging

        Returns:
            Confirmation URL string or None if not found
        """
        session_prefix = f"[{session_id}] " if session_id else ""
        logger.info(f"{session_prefix}Waiting for confirmation URL for {target_email}")

        url = get_verification_code_from_imap(
            imap_config=self.config,
            sender_keywords=sender_keywords,
            target_email=target_email,
            max_wait=max_wait,
            session_id=session_id,
            url_pattern=url_pattern,
            log_callback=lambda msg: logger.info(f"{session_prefix}{msg}"),
        )

        if url:
            logger.info(f"{session_prefix}Got confirmation URL from email")
        else:
            logger.warning(f"{session_prefix}Failed to get confirmation URL")

        return url

    def close(self):
        """Close connection pool"""
        if self._pool is not None:
            self._pool.close_all()
            self._pool = None
