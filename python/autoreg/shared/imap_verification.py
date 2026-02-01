#!/usr/bin/env python3
"""
IMAP Verification Code Retrieval

Utility for retrieving verification codes from email via IMAP.
Supports multiple search strategies for different email providers.
"""

import email as email_module
import imaplib
import re
import time
from typing import Any


def get_verification_code_from_imap(
    email: str,
    imap_config: dict[str, Any],
    max_attempts: int = 60,  # Increased from 30 to 60 (1 minute total)
    delay: int = 1  # Changed from 10s to 1s for faster polling
) -> str | None:
    """
    Get verification code from IMAP inbox

    Args:
        email: Email address to search for (registration email, e.g., test5684@whitebite.ru)
        imap_config: IMAP configuration (host, port, user, password)
        max_attempts: Maximum number of attempts (default: 60 = 1 minute with 1s delay)
        delay: Delay between attempts in seconds (default: 1s for fast polling)

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
            # Only log every 10 attempts to reduce noise
            if (attempt + 1) % 10 == 0:
                print(f"[IMAP] Still waiting... ({attempt + 1}/{max_attempts} attempts)")
            time.sleep(delay)

    print(f"[IMAP] ✗ Failed to find verification code after {max_attempts} attempts")
    return None


def _search_verification_emails(mail, target_email: str) -> list:
    """Search for verification emails using multiple strategies"""
    email_ids = []

    print(f"[IMAP] Strategy 1: Searching by TO '{target_email}'...")

    # Strategy 1: Quoted TO search (encode to ASCII for IMAP)
    try:
        # Encode email to ASCII bytes for IMAP protocol
        target_email.encode('ascii')
        result, data = mail.search(None, 'TO', f'"{target_email}"'.encode('ascii'))
        if result == 'OK' and data[0]:
            found = data[0].split()
            print(f"[IMAP] Strategy 1: Found {len(found)} emails")
            email_ids.extend(found)
    except UnicodeEncodeError:
        print("[IMAP] Strategy 1 skipped: Email contains non-ASCII characters")
    except Exception as e:
        print(f"[IMAP] Strategy 1 failed: {e}")

    # Strategy 2: Standard TO search
    if not email_ids:
        print("[IMAP] Strategy 2: Searching by TO (unquoted)...")
        try:
            result, data = mail.search(None, 'TO', target_email.encode('ascii'))
            if result == 'OK' and data[0]:
                found = data[0].split()
                print(f"[IMAP] Strategy 2: Found {len(found)} emails")
                email_ids.extend(found)
        except UnicodeEncodeError:
            print("[IMAP] Strategy 2 skipped: Email contains non-ASCII characters")
        except Exception as e:
            print(f"[IMAP] Strategy 2 failed: {e}")

    # Strategy 3: FROM AWS senders (CRITICAL for catch-all - get ALL AWS emails)
    if not email_ids:
        print("[IMAP] Strategy 3: Searching by FROM (AWS senders)...")
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
                    # Take last 5 emails only (most recent) - optimized from 50
                    recent_ids = all_ids[-5:] if len(all_ids) > 5 else all_ids
                    email_ids.extend(recent_ids)
                    if recent_ids:
                        break  # Found emails, stop searching other senders
            except Exception as e:
                print(f"[IMAP]   Failed for {sender}: {e}")
                continue

    # Strategy 4: Get ALL recent emails (last resort for catch-all)
    if not email_ids:
        print("[IMAP] Strategy 4: Getting ALL recent emails...")
        try:
            result, data = mail.search(None, 'ALL')
            if result == 'OK' and data[0]:
                all_ids = data[0].split()
                print(f"[IMAP] Strategy 4: Found {len(all_ids)} total emails")
                # Take last 5 emails only (optimized from 50)
                recent_ids = all_ids[-5:] if len(all_ids) > 5 else all_ids
                email_ids.extend(recent_ids)
        except Exception as e:
            print(f"[IMAP] Strategy 4 failed: {e}")

    # Strategy 5: FROM GitHub senders (for GitHub registrations)
    if not email_ids:
        print("[IMAP] Strategy 5: Searching by FROM (GitHub senders)...")
        github_senders = [
            'noreply@github.com',
            'no-reply@github.com',
            'notifications@github.com'
        ]
        for sender in github_senders:
            try:
                print(f"[IMAP]   Trying sender: {sender}")
                result, data = mail.search(None, 'FROM', sender)
                if result == 'OK' and data[0]:
                    # Filter by TO header to match target email
                    for eid in data[0].split():
                        try:
                            result, data = mail.fetch(eid, '(BODY[HEADER.FIELDS (TO)])')
                            if result == 'OK':
                                header = data[0][1].decode('utf-8', errors='ignore')
                                if target_email.lower() in header.lower():
                                    email_ids.append(eid)
                        except Exception:
                            continue
                    if email_ids:
                        print(f"[IMAP]   Found {len(email_ids)} matching emails")
                        break
            except Exception as e:
                print(f"[IMAP]   Failed for {sender}: {e}")
                continue

    # Strategy 6: SUBJECT containing verification keywords (last resort)
    if not email_ids:
        print("[IMAP] Strategy 6: Searching by SUBJECT (verification keywords)...")
        verification_keywords = ['verification', 'verify', 'code', 'confirm']
        for keyword in verification_keywords:
            try:
                print(f"[IMAP]   Trying keyword: {keyword}")
                result, data = mail.search(None, 'SUBJECT', keyword)
                if result == 'OK' and data[0]:
                    # Filter by TO header to match target email
                    for eid in data[0].split():
                        try:
                            result, data = mail.fetch(eid, '(BODY[HEADER.FIELDS (TO)])')
                            if result == 'OK':
                                header = data[0][1].decode('utf-8', errors='ignore')
                                if target_email.lower() in header.lower():
                                    email_ids.append(eid)
                        except Exception:
                            continue
                    if email_ids:
                        print(f"[IMAP]   Found {len(email_ids)} matching emails")
                        break
            except Exception as e:
                print(f"[IMAP]   Failed for keyword '{keyword}': {e}")
                continue

    print(f"[IMAP] Total email IDs to check: {len(email_ids)}")
    return list(set(email_ids))


def _extract_verification_code(mail, email_ids: list, target_email: str) -> str | None:
    """Extract verification code from emails"""
    # Sort by ID (newest first)
    email_ids_sorted = sorted([int(eid) for eid in email_ids], reverse=True)

    print(f"[IMAP] Checking {len(email_ids_sorted)} emails for target: {target_email}")

    # Check only last 5 emails (optimized from 50) - AWS sends email within seconds
    for email_id in email_ids_sorted[:5]:
        try:
            result, data = mail.fetch(str(email_id).encode(), '(RFC822)')
            if result != 'OK':
                continue

            raw_email = data[0][1]
            email_message = email_module.message_from_bytes(raw_email)

            # Get TO and FROM headers
            to_header = email_message.get('To', '')
            from_header = email_message.get('From', '')

            # Debug: print headers for first few emails
            if email_ids_sorted.index(email_id) < 5:
                print(f"[IMAP] Email {email_id} TO: {to_header[:100]}")
                print(f"[IMAP] Email {email_id} FROM: {from_header[:100]}")

            # Get email body first (we'll need it for both checks)
            body = _get_email_body(email_message)
            if not body:
                print(f"[IMAP] No body in email {email_id}")
                continue

            # Check 1: Target email in TO header (direct email)
            # to_match = target_email.lower() in to_header.lower()  # Unused

            # Check 2: For 33mail forwarding - check if target_email is mentioned in body
            # 33mail adds: "This email was sent to the alias 'kiro-xxx@whitebite.33mail.com'"
            body_match = target_email.lower() in body.lower()

            # Check 3: AWS sender (for catch-all scenarios)
            aws_sender = any(sender in from_header.lower() for sender in [
                'no-reply@signin.aws',
                'no-reply@amazon.com',
                'noreply@signin.aws'
            ])

            # Accept email if:
            # - AWS sender AND target email mentioned in body (33mail forwarding)
            # This ensures we only get AWS verification emails for the specific alias
            if not (aws_sender and body_match):
                continue

            print(f"[IMAP] ✓ Found AWS email for {target_email} (email #{email_id})")

            # Extract 6-digit code
            code_matches = re.findall(r'\b(\d{6})\b', body)
            if code_matches:
                # Return the FIRST 6-digit code found (verification code)
                # Skip codes that might be in 33mail unsubscribe links
                for code in code_matches:
                    # Simple heuristic: verification codes are usually not in URLs
                    # Check context around the code
                    code_index = body.find(code)
                    context = body[max(0, code_index-50):code_index+50].lower()

                    # Skip if code is in unsubscribe link or URL
                    if 'unsub' in context or 'http' in context or 'link' in context:
                        continue

                    print(f"[IMAP] ✓ Found verification code: {code}")
                    return str(code)

                # Fallback: return first code if no valid code found
                print(f"[IMAP] ✓ Found verification code (fallback): {code_matches[0]}")
                return str(code_matches[0])
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
