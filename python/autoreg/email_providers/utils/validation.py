"""
Email validation utilities.

Provides functions for validating email addresses according to RFC 5322.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# RFC 5322 simplified email pattern
EMAIL_PATTERN = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')

# Maximum email length per RFC 5321
MAX_EMAIL_LENGTH = 254


def is_valid_email(email: str) -> bool:
    """
    Check if email address is valid.

    Args:
        email: Email address to validate

    Returns:
        True if valid, False otherwise

    Example:
        >>> is_valid_email("user@example.com")
        True
        >>> is_valid_email("invalid.email")
        False
    """
    if not email:
        return False

    if len(email) > MAX_EMAIL_LENGTH:
        return False

    return EMAIL_PATTERN.match(email) is not None


def validate_email(email: str) -> str:
    """
    Validate email address and return it.

    Args:
        email: Email address to validate

    Returns:
        The validated email address

    Raises:
        ValueError: If email is invalid

    Example:
        >>> validate_email("user@example.com")
        'user@example.com'
        >>> validate_email("invalid")
        ValueError: Invalid email format: invalid
    """
    if not email:
        raise ValueError("Email cannot be empty")

    if len(email) > MAX_EMAIL_LENGTH:
        raise ValueError(
            f"Email too long: {len(email)} > {MAX_EMAIL_LENGTH} characters"
        )

    if not EMAIL_PATTERN.match(email):
        raise ValueError(f"Invalid email format: {email}")

    return email


def extract_domain(email: str) -> str:
    """
    Extract domain from email address.

    Args:
        email: Email address

    Returns:
        Domain part of email

    Raises:
        ValueError: If email is invalid

    Example:
        >>> extract_domain("user@example.com")
        'example.com'
    """
    validate_email(email)
    return email.split('@')[1]


def extract_local_part(email: str) -> str:
    """
    Extract local part from email address.

    Args:
        email: Email address

    Returns:
        Local part of email (before @)

    Raises:
        ValueError: If email is invalid

    Example:
        >>> extract_local_part("user@example.com")
        'user'
    """
    validate_email(email)
    return email.split('@')[0]
