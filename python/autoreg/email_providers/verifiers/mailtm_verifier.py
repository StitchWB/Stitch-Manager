"""Mail.tm email verifier"""
import logging
import time
import re
from typing import List
from ..base import IEmailVerifier, EmailContext
from ...services.mailtm import MailTmService, MailTmConfig

logger = logging.getLogger(__name__)


class MailTmVerifier(IEmailVerifier):
    """Verifier that retrieves verification codes from Mail.tm"""
    
    def __init__(self, config: MailTmConfig | None = None):
        """
        Initialize Mail.tm verifier
        
        Args:
            config: MailTmConfig object (uses defaults if None)
        """
        self.config = config or MailTmConfig()
        self.service = MailTmService(self.config)
    
    def verify(
        self,
        context: EmailContext,
        sender_keywords: List[str],
        max_wait: int = 120,
        session_id: str | None = None,
        url_pattern: str | None = None,
    ) -> str | None:
        """
        Get verification code or URL from Mail.tm inbox
        
        Args:
            context: EmailContext with email and password in metadata
            sender_keywords: Keywords to match in sender address/name
            max_wait: Maximum seconds to wait for email
            session_id: Optional session identifier for logging
            url_pattern: Regex pattern to extract a URL instead of a code.
                         If provided, returns the first URL matching this pattern.
            
        Returns:
            Verification code or URL if found, None otherwise
        """
        log_prefix = f"[{session_id}]" if session_id else ""
        logger.info(
            f"{log_prefix} Checking Mail.tm inbox for {context.email}, "
            f"waiting up to {max_wait}s"
        )
        
        # Get credentials from metadata
        password = context.metadata.get('password')
        if not password:
            logger.error(f"{log_prefix} No password in context metadata")
            return None
        
        # Login to Mail.tm
        try:
            self.service.login(context.email, password)
        except Exception as e:
            logger.error(f"{log_prefix} Failed to login to Mail.tm: {e}")
            return None
        
        start_time = time.time()
        check_interval = 5  # Check every 5 seconds
        
        while time.time() - start_time < max_wait:
            try:
                # Get messages
                messages = self.service.get_messages()
                
                # Filter messages by sender keywords
                for msg in messages:
                    sender = msg.get('from', {})
                    sender_address = sender.get('address', '').lower()
                    sender_name = sender.get('name', '').lower()
                    
                    # Check if sender matches keywords
                    matches = any(
                        keyword.lower() in sender_address or keyword.lower() in sender_name
                        for keyword in sender_keywords
                    )
                    
                    if matches:
                        # Get full message with body
                        full_msg = self.service.get_message(msg['id'])
                        
                        if url_pattern:
                            # Extract URL from message
                            url = self._extract_url(full_msg, url_pattern)
                            if url:
                                logger.info(
                                    f"{log_prefix} Found confirmation URL "
                                    f"from {sender_address}"
                                )
                                return url
                        else:
                            # Extract code from message
                            code = self._extract_code(full_msg)
                            if code:
                                logger.info(
                                    f"{log_prefix} Found verification code: {code} "
                                    f"from {sender_address}"
                                )
                                return code
                
                # Wait before next check
                elapsed = time.time() - start_time
                remaining = max_wait - elapsed
                
                if remaining > 0:
                    wait_time = min(check_interval, remaining)
                    logger.debug(
                        f"{log_prefix} No matching messages yet, "
                        f"waiting {wait_time:.1f}s..."
                    )
                    time.sleep(wait_time)
            
            except Exception as e:
                logger.error(f"{log_prefix} Error checking messages: {e}")
                time.sleep(check_interval)
        
        logger.warning(
            f"{log_prefix} No {'URL' if url_pattern else 'verification code'} "
            f"found after {max_wait}s"
        )
        return None
    
    def _extract_code(self, message: dict) -> str | None:
        """
        Extract verification code from message
        
        Args:
            message: Full message object with 'text' and 'html' fields
            
        Returns:
            Verification code if found, None otherwise
        """
        # Try text content first
        text = message.get('text', '')
        code = self._find_code_in_text(text)
        if code:
            return code
        
        # Try HTML content
        html = message.get('html', [])
        if isinstance(html, list):
            html = ' '.join(html)
        
        code = self._find_code_in_text(html)
        return code
    
    def _find_code_in_text(self, text: str) -> str | None:
        """
        Find verification code in text using regex patterns
        
        Args:
            text: Text to search
            
        Returns:
            Verification code if found, None otherwise
        """
        # Common patterns for verification codes
        patterns = [
            r'\b(\d{6})\b',  # 6-digit code
            r'\b([A-Z0-9]{6})\b',  # 6-char alphanumeric
            r'\b(\d{4,8})\b',  # 4-8 digit code
            r'code[:\s]+([A-Z0-9]{4,8})',  # "code: XXXXX"
            r'verification[:\s]+([A-Z0-9]{4,8})',  # "verification: XXXXX"
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1)
        
        return None
    
    def _extract_url(self, message: dict, url_pattern: str) -> str | None:
        """
        Extract a URL from message matching the given pattern
        
        Args:
            message: Full message object with 'text' and 'html' fields
            url_pattern: Regex pattern to match URLs
            
        Returns:
            URL if found, None otherwise
        """
        # Try text content first
        text = message.get('text', '')
        url = self._find_url_in_text(text, url_pattern)
        if url:
            return url
        
        # Try HTML content
        html = message.get('html', [])
        if isinstance(html, list):
            html = ' '.join(html)
        
        url = self._find_url_in_text(html, url_pattern)
        return url
    
    def _find_url_in_text(self, text: str, url_pattern: str) -> str | None:
        """
        Find URL matching pattern in text
        
        Args:
            text: Text to search
            url_pattern: Regex pattern to match URLs
            
        Returns:
            URL if found, None otherwise
        """
        # Decode HTML entities that might break URLs
        text = text.replace('&amp;', '&')
        
        match = re.search(url_pattern, text)
        if match:
            return match.group(0)
        
        return None
    
    def get_verification_code(
        self,
        target_email: str,
        sender_keywords: list[str],
        max_wait: int = 120,
        session_id: str | None = None
    ) -> str | None:
        """
        Get verification code (IEmailVerifier interface)
        
        Note: For Mail.tm, you need to pass EmailContext with password
        to verify() method instead. This method is for compatibility.
        
        Args:
            target_email: Email address to check
            sender_keywords: Keywords to match in sender
            max_wait: Maximum seconds to wait
            session_id: Optional session identifier
            
        Returns:
            None (use verify() with EmailContext instead)
        """
        logger.warning(
            "get_verification_code() not supported for Mail.tm. "
            "Use verify() with EmailContext containing password."
        )
        return None
    
    def close(self) -> None:
        """Close service resources"""
        self.service.close()
