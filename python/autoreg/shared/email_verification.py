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
from email.header import decode_header
from email.utils import parsedate_to_datetime
from typing import Optional, Dict, Callable, Any


def _extract_verification_code_from_text(text: str) -> Optional[str]:
    """Extract verification code using common patterns."""
    patterns = [
        r'\b(\d{6})\b',
        r'\b([A-Z0-9]{6})\b',
        r'\b(\d{4,8})\b',
        r'code[:\s]+([A-Z0-9]{4,8})',
        r'verification[:\s]+([A-Z0-9]{4,8})',
    ]
    for pattern in patterns:
        match = re.search(pattern, text or "", re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def get_verification_code_from_mailtm(
    mailtm_config: Dict[str, Any],
    sender_keywords: list[str],
    max_wait: int = 120,
    time_window: int = 300,
    log_callback: Optional[Callable] = None,
    target_email: Optional[str] = None,
    session_id: Optional[str] = None,
) -> Optional[str]:
    """
    Retrieve verification code from an existing Mail.tm mailbox.

    mailtm_config keys:
      - address (required)
      - password (required)
      - base_url (optional)
    """

    def log(message: str):
        prefix = f"[{session_id}]" if session_id else ""
        full_message = f"{prefix} {message}" if prefix else message
        if log_callback:
            log_callback(full_message)

    address = (mailtm_config.get('address') or '').strip()
    password = (mailtm_config.get('password') or '').strip()
    base_url = (mailtm_config.get('base_url') or '').strip() or "https://api.mail.tm"

    if not address or not password:
        log("[Mail.tm] Missing mailbox credentials")
        return None

    try:
        from ..services.mailtm import MailTmConfig, MailTmService

        service = MailTmService(MailTmConfig(base_url=base_url))
        try:
            service.login(address, password)
        except Exception as e:
            log(f"[Mail.tm] Login failed: {e}")
            service.close()
            return None

        start_time = time.time()
        cutoff_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=time_window)

        while time.time() - start_time < max_wait:
            try:
                messages = service.get_messages(page=1)
            except Exception as e:
                log(f"[Mail.tm] Failed to fetch messages: {e}")
                time.sleep(3)
                continue

            for msg in messages:
                try:
                    created_at_raw = msg.get('createdAt') or msg.get('created_at')
                    if created_at_raw:
                        created_dt = parsedate_to_datetime(created_at_raw) if ',' in created_at_raw else datetime.datetime.fromisoformat(created_at_raw.replace('Z', '+00:00'))
                        if created_dt.tzinfo is None:
                            created_dt = created_dt.replace(tzinfo=datetime.timezone.utc)
                        if created_dt < cutoff_time:
                            continue
                except Exception:
                    pass

                sender = msg.get('from') or {}
                sender_address = (sender.get('address') or '').lower()
                sender_name = (sender.get('name') or '').lower()
                if sender_keywords:
                    matches = any(
                        keyword.lower() in sender_address or keyword.lower() in sender_name
                        for keyword in sender_keywords
                    )
                    if not matches:
                        continue

                if target_email:
                    to_list = msg.get('to') or []
                    if isinstance(to_list, list) and to_list:
                        recipient_addresses = [
                            (entry.get('address') or '').lower()
                            for entry in to_list
                            if isinstance(entry, dict)
                        ]
                        if recipient_addresses and target_email.lower() not in recipient_addresses:
                            continue

                message_id = msg.get('id')
                if not message_id:
                    continue

                try:
                    full_msg = service.get_message(message_id)
                except Exception:
                    continue

                text = full_msg.get('text') or ''
                code = _extract_verification_code_from_text(text)
                if not code:
                    html = full_msg.get('html') or []
                    if isinstance(html, list):
                        html_text = ' '.join(str(x) for x in html)
                    else:
                        html_text = str(html)
                    code = _extract_verification_code_from_text(re.sub(r'<[^>]*>', ' ', html_text))

                if code:
                    log(f"[Mail.tm] Verification code found: {code}")
                    service.close()
                    return code

            time.sleep(3)

        log("[Mail.tm] Verification code not found within timeout")
        service.close()
        return None
    except Exception as e:
        log(f"[Mail.tm] Unexpected error: {e}")
        return None


def decode_header_value(header_value: str) -> str:
    if not header_value:
        return ""
    try:
        decoded = decode_header(header_value)
        parts: list[str] = []
        for part, encoding in decoded:
            if isinstance(part, bytes):
                parts.append(part.decode(encoding or "utf-8", errors="ignore"))
            else:
                parts.append(str(part))
        return "".join(parts)
    except Exception:
        return str(header_value)


def extract_body_text(msg: Any) -> str:
    plain = ""
    html = ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = (part.get_content_type() or "").lower()
            if ctype not in ("text/plain", "text/html"):
                continue
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            text = payload.decode("utf-8", errors="ignore")
            if ctype == "text/plain" and not plain:
                plain = text
            elif ctype == "text/html" and not html:
                html = text
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            plain = payload.decode("utf-8", errors="ignore")

    if plain:
        return plain

    if html:
        return re.sub(r"<[^>]*>", " ", html)

    return ""


def get_verification_code_from_imap(
    imap_config: Dict[str, Any],
    sender_keywords: list[str],
    subject_pattern: Optional[str] = None,
    max_wait: int = 120,
    time_window: int = 300,
    log_callback: Optional[Callable] = None,
    target_email: Optional[str] = None,
    session_id: Optional[str] = None,
    max_retries: int = 3,
    logger=None,
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
            session_id=session_id,
            logger=logger,
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
    imap_config: Dict[str, Any],
    sender_keywords: list[str],
    subject_pattern: Optional[str],
    max_wait: int,
    time_window: int,
    log_callback: Optional[Callable],
    target_email: Optional[str],
    session_id: Optional[str],
    logger=None,
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

    host = str(host)
    user = str(user)
    password = str(password)
    try:
        port = int(port)
    except Exception:
        port = 993
    
    start_time = time.time()
    cutoff_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=time_window)
    last_error = None
    
    # Build search query for primary keyword
    primary_keyword = sender_keywords[0] if sender_keywords else None
    if not primary_keyword:
        log("[Email] No sender keywords provided")
        return None
    
    poll_interval_sec = 3

    while time.time() - start_time < max_wait:
        try:
            mail = imaplib.IMAP4_SSL(str(host), int(port), timeout=10)
            try:
                if getattr(mail, 'sock', None):
                    mail.sock.settimeout(10)
            except Exception:
                pass
            mail.login(str(user), str(password))
            mail.select('INBOX')
            
            messages = None
            search_queries = [
                ('FROM', primary_keyword),
                ('FROM', 'verify.windsurf.ai'),
                ('SUBJECT', 'Windsurf'),
            ]

            for key, value in search_queries:
                try:
                    _, candidate = mail.search(None, key, value)
                    if candidate and candidate[0]:
                        messages = candidate
                        break
                except Exception:
                    continue
            
            if messages and messages[0]:
                email_ids = messages[0].split()
                
                # Check only last 10 emails (newest first)
                for num in reversed(email_ids[-10:]):
                    try:
                        _, msg_data = mail.fetch(num, '(RFC822)')
                        if not msg_data[0]:
                            continue
                        
                        payload_bytes = None
                        first_item = msg_data[0]
                        if isinstance(first_item, tuple) and len(first_item) > 1:
                            maybe_bytes = first_item[1]
                            if isinstance(maybe_bytes, (bytes, bytearray)):
                                payload_bytes = bytes(maybe_bytes)
                        if not payload_bytes:
                            continue

                        msg = email_lib.message_from_bytes(payload_bytes)
                        
                        # Get headers
                        date_str = msg.get('Date', '')
                        from_addr = decode_header_value(msg.get('From', '')).lower()
                        subject = decode_header_value(msg.get('Subject', '')).strip()
                        
                        # Verify sender matches any keyword
                        if not any(keyword.lower() in from_addr for keyword in sender_keywords):
                            continue
                        
                        # Check email timestamp
                        try:
                            email_date = parsedate_to_datetime(date_str)
                            if email_date.tzinfo is None:
                                email_date = email_date.replace(tzinfo=datetime.timezone.utc)
                            if email_date < cutoff_time:
                                continue
                        except Exception:
                            pass
                        
                        body = extract_body_text(msg)
                        
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

                        subject_fallback = re.findall(r"\b(\d{6})\b", subject)
                        if subject_fallback:
                            mail.logout()
                            log(f"[Email] Found code in subject: {subject_fallback[0]} (email date: {date_str})")
                            return subject_fallback[0]
                        
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
        
        time.sleep(poll_interval_sec)
    
    if last_error:
        log(f"[Email] Failed to get verification code: {last_error}")
    
    return None
