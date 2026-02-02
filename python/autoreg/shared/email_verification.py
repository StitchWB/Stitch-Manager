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
    log_callback: Optional[Callable] = None,
    target_email: Optional[str] = None,
    session_id: Optional[str] = None,
    max_retries: int = 3
) -> Optional[str]:
    r"""
    Universal function to retrieve verification code from IMAP with retry logic.
    
    Args:
        imap_config: IMAP configuration dict with host, port, user, password
        sender_keywords: List of keywords to match in FROM header (e.g., ['windsurf', 'codeium'])
        subject_pattern: Optional regex pattern to extract code from subject
        max_wait: Maximum time to wait for email (seconds)
        time_window: Only check emails within this many seconds before now (default: 5 minutes)
        log_callback: Optional callback for logging messages
        target_email: Optional email address to validate against (for catch-all/forwarding services)
        session_id: Optional session ID for log traceability in parallel registrations
        max_retries: Maximum number of retries on email mismatch (default: 3)
    
    Returns:
        6-digit verification code or None if not found
    
    Example:
        # For Windsurf with email validation
        code = get_verification_code_from_imap(
            imap_config={'host': 'imap.gmail.com', 'port': 993, 'user': '...', 'password': '...'},
            sender_keywords=['windsurf', 'codeium'],
            subject_pattern=r'^(\d{6})\s*-',  # Extract from "229743 - Verify your Email"
            target_email='kiro-um8twn0n@whitebite.33mail.com',
            session_id='reg_a1b2c3d4'
        )
        
        # For AWS/Kiro
        code = get_verification_code_from_imap(
            imap_config={...},
            sender_keywords=['aws', 'amazon', 'signin'],
            target_email='user@example.com',
            session_id='reg_x9y8z7w6'
        )
    """
    
    def log(message: str):
        """Helper to log messages with session ID"""
        prefix = f"[{session_id}]" if session_id else ""
        full_message = f"{prefix} {message}" if prefix else message
        if log_callback:
            log_callback(full_message)
    
    # Retry logic with exponential backoff
    retry_delays = [1, 2, 4, 8]  # Exponential backoff: 1s, 2s, 4s, 8s
    
    for retry_attempt in range(max_retries):
        if retry_attempt > 0:
            delay = retry_delays[min(retry_attempt - 1, len(retry_delays) - 1)]
            log(f"[Email] Retry attempt {retry_attempt + 1}/{max_retries} after {delay}s delay (reason: email mismatch)")
            time.sleep(delay)
        
        # Try to get verification code
        code = _get_verification_code_internal(
            imap_config=imap_config,
            sender_keywords=sender_keywords,
            subject_pattern=subject_pattern,
            max_wait=max_wait,
            time_window=time_window,
            log_callback=log_callback,
            target_email=target_email,
            session_id=session_id
        )
        
        if code:
            if retry_attempt > 0:
                log(f"[Email] Successfully retrieved code after {retry_attempt + 1} attempts")
            return code
        
        # If no code found and we have retries left, log and continue
        if retry_attempt < max_retries - 1:
            log(f"[Email] No matching code found, will retry...")
    
    log(f"[Email] Failed to retrieve verification code after {max_retries} attempts")
    return None


def _get_verification_code_internal(
    imap_config: Dict[str, any],
    sender_keywords: list[str],
    subject_pattern: Optional[str],
    max_wait: int,
    time_window: int,
    log_callback: Optional[Callable],
    target_email: Optional[str],
    session_id: Optional[str]
) -> Optional[str]:
    """
    Internal function to retrieve verification code from IMAP (single attempt).
    This is called by get_verification_code_from_imap with retry logic.
    """
    
    def log(message: str):
        """Helper to log messages with session ID"""
        prefix = f"[{session_id}]" if session_id else ""
        full_message = f"{prefix} {message}" if prefix else message
        if log_callback:
            log_callback(full_message)
    
    host = imap_config.get('host')
    port = imap_config.get('port', 993)
    user = imap_config.get('user')
    password = imap_config.get('password')
    
    if not all([host, user, password]):
        log("[Email] Incomplete IMAP config")
        return None
    
    start_time = time.time()
    # Search start time: 30 seconds before NOW to account for email delivery delay
    # This ensures we only get emails that arrived AFTER registration started
    registration_start = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=30)
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
                        
                        # Check email timestamp (only emails AFTER registration started)
                        try:
                            email_date = parsedate_to_datetime(date_str)
                            
                            # Skip emails that arrived BEFORE registration started
                            # (prevents using codes from previous registration attempts)
                            if email_date < registration_start:
                                continue
                            
                            # Skip future emails (clock skew tolerance: 1 minute)
                            if email_date > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=60):
                                continue
                        except Exception:
                            # If date parsing fails, skip this email (safer than using old code)
                            continue
                        
                        # Extract from body (needed for both subject and body extraction)
                        body = ''
                        if msg.is_multipart():
                            for part in msg.walk():
                                if part.get_content_type() == 'text/plain':
                                    body = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                                    break
                        else:
                            body = msg.get_payload(decode=True).decode('utf-8', errors='ignore')
                        
                        # Email validation: Check if target_email is mentioned in body
                        # This prevents using codes from wrong emails in parallel registrations
                        if target_email:
                            email_in_body = target_email.lower() in body.lower()
                            log(f"[Email] Searching for: {target_email}, Found in body: {email_in_body}")
                            
                            if not email_in_body:
                                log(f"[Email] Skipping email - target email not found in body")
                                continue
                        
                        # Try to extract code from subject first (if pattern provided)
                        if subject_pattern:
                            subject_codes = re.findall(subject_pattern, subject)
                            if subject_codes:
                                mail.logout()
                                log(f"[Email] Found code in subject: {subject_codes[0]} (email date: {date_str})")
                                return subject_codes[0]
                        
                        # Look for 6-digit code in body
                        codes = re.findall(r'\b(\d{6})\b', body)
                        if codes:
                            mail.logout()
                            log(f"[Email] Found code in body: {codes[0]} (email date: {date_str})")
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
