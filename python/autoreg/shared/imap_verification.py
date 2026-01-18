#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
IMAP Verification Code Retrieval

Utility for retrieving verification codes from email via IMAP.
Supports multiple search strategies for different email providers.
"""

import imaplib
import email as email_module
import re
import time
from typing import Optional, Dict, Any


def get_verification_code_from_imap(
    email: str,
    imap_config: Dict[str, Any],
    max_attempts: int = 30,
    delay: int = 10
) -> Optional[str]:
    """
    Get verification code from IMAP inbox
    
    Args:
        email: Email address to search for (registration email, e.g., test5684@whitebite.ru)
        imap_config: IMAP configuration (host, port, user, password)
        max_attempts: Maximum number of attempts
        delay: Delay between attempts in seconds
        
    Returns:
        Verification code (6 digits) or None if not found
    """
    print(f"[IMAP] Waiting for verification code for: {email}")
    print(f"[IMAP] Connecting to: {imap_config['user']}@{imap_config['host']}")
    
    for attempt in range(max_attempts):
        try:
            # Connect to IMAP
            mail = imaplib.IMAP4_SSL(imap_config['host'], imap_config['port'])
            mail.login(imap_config['user'], imap_config['password'])
            mail.select('INBOX')
            
            print(f"[IMAP] Attempt {attempt + 1}/{max_attempts} - Searching for emails...")
            
            # Search for verification emails
            email_ids = _search_verification_emails(mail, email)
            
            print(f"[IMAP] Found {len(email_ids)} potential emails")
            
            if email_ids:
                # Check emails for verification code
                code = _extract_verification_code(mail, email_ids, email)
                if code:
                    mail.close()
                    mail.logout()
                    return code
            
            mail.close()
            mail.logout()
            
        except Exception as e:
            print(f"[IMAP] Attempt {attempt + 1}/{max_attempts} failed: {e}")
        
        if attempt < max_attempts - 1:
            print(f"[IMAP] Waiting {delay}s before next attempt...")
            time.sleep(delay)
    
    print(f"[IMAP] ✗ Failed to find verification code after {max_attempts} attempts")
    return None


def _search_verification_emails(mail, target_email: str) -> list:
    """Search for verification emails using multiple strategies"""
    email_ids = []
    
    print(f"[IMAP] Strategy 1: Searching by TO '{target_email}'...")
    
    # Strategy 1: Quoted TO search
    try:
        result, data = mail.search(None, 'TO', f'"{target_email}"')
        if result == 'OK' and data[0]:
            found = data[0].split()
            print(f"[IMAP] Strategy 1: Found {len(found)} emails")
            email_ids.extend(found)
    except Exception as e:
        print(f"[IMAP] Strategy 1 failed: {e}")
    
    # Strategy 2: Standard TO search
    if not email_ids:
        print(f"[IMAP] Strategy 2: Searching by TO (unquoted)...")
        try:
            result, data = mail.search(None, 'TO', target_email)
            if result == 'OK' and data[0]:
                found = data[0].split()
                print(f"[IMAP] Strategy 2: Found {len(found)} emails")
                email_ids.extend(found)
        except Exception as e:
            print(f"[IMAP] Strategy 2 failed: {e}")
    
    # Strategy 3: FROM AWS senders (CRITICAL for catch-all - get ALL AWS emails)
    if not email_ids:
        print(f"[IMAP] Strategy 3: Searching by FROM (AWS senders)...")
        aws_senders = [
            'no-reply@signin.aws',
            'no-reply@amazon.com',
            'noreply@signin.aws'
        ]
        for sender in aws_senders:
            try:
                print(f"[IMAP]   Trying sender: {sender}")
                result, data = mail.search(None, 'FROM', sender)
                if result == 'OK' and data[0]:
                    # For catch-all: get all AWS emails, filter by body content later
                    all_ids = data[0].split()
                    print(f"[IMAP]   Found {len(all_ids)} emails from {sender}")
                    # Take last 50 emails (most recent)
                    recent_ids = all_ids[-50:] if len(all_ids) > 50 else all_ids
                    email_ids.extend(recent_ids)
                    if recent_ids:
                        break  # Found emails, stop searching other senders
            except Exception as e:
                print(f"[IMAP]   Failed for {sender}: {e}")
                continue
    
    # Strategy 4: Get ALL recent emails (last resort for catch-all)
    if not email_ids:
        print(f"[IMAP] Strategy 4: Getting ALL recent emails...")
        try:
            result, data = mail.search(None, 'ALL')
            if result == 'OK' and data[0]:
                all_ids = data[0].split()
                print(f"[IMAP] Strategy 4: Found {len(all_ids)} total emails")
                # Take last 100 emails
                recent_ids = all_ids[-100:] if len(all_ids) > 100 else all_ids
                email_ids.extend(recent_ids)
        except Exception as e:
            print(f"[IMAP] Strategy 4 failed: {e}")
    
    print(f"[IMAP] Total email IDs to check: {len(email_ids)}")
    return list(set(email_ids))
    
    # Strategy 4: FROM GitHub senders
    if not email_ids:
        github_senders = [
            'noreply@github.com',
            'no-reply@github.com',
            'notifications@github.com'
        ]
        for sender in github_senders:
            try:
                result, data = mail.search(None, 'FROM', sender)
                if result == 'OK' and data[0]:
                    # Filter by TO header
                    for eid in data[0].split():
                        try:
                            result, data = mail.fetch(eid, '(BODY[HEADER.FIELDS (TO)])')
                            if result == 'OK':
                                header = data[0][1].decode('utf-8', errors='ignore')
                                if target_email.lower() in header.lower():
                                    email_ids.append(eid)
                        except Exception:
                            continue
            except Exception:
                continue
    
    # Strategy 5: SUBJECT containing verification keywords
    if not email_ids:
        verification_keywords = ['verification', 'verify']
        for keyword in verification_keywords:
            try:
                result, data = mail.search(None, 'SUBJECT', keyword)
                if result == 'OK' and data[0]:
                    # Filter by TO header
                    for eid in data[0].split():
                        try:
                            result, data = mail.fetch(eid, '(BODY[HEADER.FIELDS (TO)])')
                            if result == 'OK':
                                header = data[0][1].decode('utf-8', errors='ignore')
                                if target_email.lower() in header.lower():
                                    email_ids.append(eid)
                        except Exception:
                            continue
            except Exception:
                continue
    
    return list(set(email_ids))


def _extract_verification_code(mail, email_ids: list, target_email: str) -> Optional[str]:
    """Extract verification code from emails"""
    # Sort by ID (newest first)
    email_ids_sorted = sorted([int(eid) for eid in email_ids], reverse=True)
    
    print(f"[IMAP] Checking {len(email_ids_sorted)} emails for target: {target_email}")
    
    # Check up to 50 most recent emails (increased for catch-all)
    for email_id in email_ids_sorted[:50]:
        try:
            result, data = mail.fetch(str(email_id).encode(), '(RFC822)')
            if result != 'OK':
                continue
            
            raw_email = data[0][1]
            email_message = email_module.message_from_bytes(raw_email)
            
            # Get TO header - for catch-all, check if target_email is in TO
            to_header = email_message.get('To', '')
            
            # Debug: print TO header for first few emails
            if email_ids_sorted.index(email_id) < 5:
                print(f"[IMAP] Email {email_id} TO: {to_header[:100]}")
            
            # Check if target email is in TO header (catch-all: testmail@whitebite.ru receives, but TO is test5684@whitebite.ru)
            if target_email.lower() not in to_header.lower():
                continue
            
            print(f"[IMAP] ✓ Found email for {target_email}")
            
            # Get email body
            body = _get_email_body(email_message)
            if not body:
                print(f"[IMAP] No body in email {email_id}")
                continue
            
            # Extract 6-digit code
            code_matches = re.findall(r'\b(\d{6})\b', body)
            if code_matches:
                print(f"[IMAP] ✓ Found verification code: {code_matches[0]}")
                return code_matches[0]
            else:
                print(f"[IMAP] No 6-digit code found in email {email_id}")
                
        except Exception as e:
            print(f"[IMAP] Error processing email {email_id}: {e}")
            continue
    
    print(f"[IMAP] ✗ No verification code found for {target_email}")
    return None


def _get_email_body(email_message) -> str:
    """Extract plain text body from email message"""
    body = ""
    
    if email_message.is_multipart():
        for part in email_message.walk():
            if part.get_content_type() == "text/plain":
                body = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                break
            elif part.get_content_type() == "text/html" and not body:
                body = part.get_payload(decode=True).decode('utf-8', errors='ignore')
    else:
        body = email_message.get_payload(decode=True).decode('utf-8', errors='ignore')
    
    return body
