"""
Universal email verification code retrieval module.

This module provides a unified way to retrieve verification codes from IMAP
for any registration provider. It works with all email strategies:
- STATIC (direct email)
- COUNTER (email+N)
- 33MAIL (catch-all forwarding)
- ADDYIO (alias forwarding)
"""

import re
import time
import datetime
import imaplib
import email as email_lib
from email.utils import parsedate_to_datetime
from typing import Optional, Dict, Callable


def get_verification_code_from_imap(
    imap_config: Dict[str, any],
    sender_keywords: list[str],
    subject_pattern: Optional[str] = None,
    max_wait: int = 120,
    time_window: int = 300,
    log_callback: Optional[Callable] = None
) -> Optional[str]:
    r"""
    Universal function to retrieve verification code from IMAP.
    
    Args:
        imap_config: IMAP configuration dict with host, port, user, password
        sender_keywords: List of keywords to match in FROM header (e.g., ['windsurf', 'codeium'])
        subject_pattern: Optional regex pattern to extract code from subject
        max_wait: Maximum time to wait for email (seconds)
        time_window: Only check emails within this many seconds before now (default: 5 minutes)
        log_callback: Optional callback for logging messages
    
    Returns:
        6-digit verification code or None if not found
    
    Example:
        # For Windsurf
        code = get_verification_code_from_imap(
            imap_config={'host': 'imap.gmail.com', 'port': 993, 'user': '...', 'password': '...'},
            sender_keywords=['windsurf', 'codeium'],
            subject_pattern=r'^(\d{6})\s*-'  # Extract from "229743 - Verify your Email"
        )
        
        # For AWS/Kiro
        code = get_verification_code_from_imap(
            imap_config={...},
            sender_keywords=['aws', 'amazon', 'signin']
        )
    """
    
    def log(message: str):
        """Helper to log messages"""
        if log_callback:
            log_callback(message)
    
    host = imap_config.get('host')
    port = imap_config.get('port', 993)
    user = imap_config.get('user')
    password = imap_config.get('password')
    
    if not all([host, user, password]):
        log("[Email] Incomplete IMAP config")
        return None
    
    start_time = time.time()
    registration_start = datetime.datetime.now(datetime.timezone.utc)
    last_error = None
    
    # Build search query for primary keyword
    primary_keyword = sender_keywords[0] if sender_keywords else None
    if not primary_keyword:
        log("[Email] No sender keywords provided")
        return None
    
    while time.time() - start_time < max_wait:
        try:
            mail = imaplib.IMAP4_SSL(host, port)
            mail.login(user, password)
            mail.select('INBOX')
            
            # Search by FROM with primary keyword
            _, messages = mail.search(None, 'FROM', primary_keyword)
            
            if messages[0]:
                email_ids = messages[0].split()
                
                # Check last 20 emails (newest first)
                for num in reversed(email_ids[-20:]):
                    try:
                        _, msg_data = mail.fetch(num, '(RFC822)')
                        if not msg_data[0]:
                            continue
                        
                        msg = email_lib.message_from_bytes(msg_data[0][1])
                        
                        # Get headers
                        date_str = msg.get('Date', '')
                        from_addr = msg.get('From', '').lower()
                        subject = msg.get('Subject', '')
                        
                        # Verify sender matches any keyword
                        if not any(keyword.lower() in from_addr for keyword in sender_keywords):
                            continue
                        
                        # Check email timestamp (only recent emails)
                        try:
                            email_date = parsedate_to_datetime(date_str)
                            time_diff = (registration_start - email_date).total_seconds()
                            
                            # Skip old emails (older than time_window)
                            if time_diff > time_window:
                                continue
                            
                            # Skip future emails (clock skew tolerance: 1 minute)
                            if time_diff < -60:
                                continue
                        except Exception:
                            # If date parsing fails, still try to extract code
                            pass
                        
                        # Try to extract code from subject first (if pattern provided)
                        if subject_pattern:
                            subject_codes = re.findall(subject_pattern, subject)
                            if subject_codes:
                                mail.logout()
                                log(f"[Email] Found code in subject: {subject_codes[0]}")
                                return subject_codes[0]
                        
                        # Extract from body (fallback or primary method)
                        body = ''
                        if msg.is_multipart():
                            for part in msg.walk():
                                if part.get_content_type() == 'text/plain':
                                    body = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                                    break
                        else:
                            body = msg.get_payload(decode=True).decode('utf-8', errors='ignore')
                        
                        # Look for 6-digit code in body
                        codes = re.findall(r'\b(\d{6})\b', body)
                        if codes:
                            mail.logout()
                            log(f"[Email] Found code in body: {codes[0]}")
                            return codes[0]
                    
                    except Exception as e:
                        log(f"[Email] Error processing email: {e}")
                        continue
            
            mail.logout()
        
        except Exception as e:
            last_error = str(e)
            log(f"[Email] IMAP error: {e}")
        
        time.sleep(5)
    
    if last_error:
        log(f"[Email] Failed to get verification code: {last_error}")
    
    return None
