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
        self.pool = ImapConnectionPool(imap_config, pool_size)
    
    def get_verification_code(
        self,
        target_email: str,
        sender_keywords: list[str],
        max_wait: int = 120,
        session_id: str | None = None
    ) -> str | None:
        """
        Get verification code from IMAP inbox
        
        Args:
            target_email: Email address to filter by
            sender_keywords: Keywords to match in sender (e.g., ['github', 'noreply'])
            max_wait: Maximum seconds to wait for code
            session_id: Optional session ID for logging
        
        Returns:
            Verification code or None if not found
        """
        session_prefix = f"[{session_id}] " if session_id else ""
        logger.info(f"{session_prefix}Waiting for verification code for {target_email}")
        
        # Use existing verification logic
        code = get_verification_code_from_imap(
            imap_config=self.config,
            sender_keywords=sender_keywords,
            target_email=target_email,
            max_wait=max_wait,
            session_id=session_id,
            log_callback=lambda msg: logger.info(f"{session_prefix}{msg}")
        )
        
        if code:
            logger.info(f"{session_prefix}Got verification code: {code}")
        else:
            logger.warning(f"{session_prefix}Failed to get verification code")
        
        return code
    
    def close(self):
        """Close connection pool"""
        self.pool.close_all()
