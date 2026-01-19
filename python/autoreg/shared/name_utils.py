"""Name generation utilities for account registration."""

import re
import random
import string


def generate_name_from_email(email: str) -> str:
    """
    Generate a display name from email local part.
    
    Converts email addresses like:
    - john.doe@example.com -> "John Doe"
    - johndoe123@example.com -> "Johndoe"
    - j.doe@example.com -> "J Doe"
    
    Args:
        email: Email address
        
    Returns:
        Formatted display name suitable for registration forms
        
    Example:
        >>> generate_name_from_email("john.doe@example.com")
        'John Doe'
        >>> generate_name_from_email("johndoe123@example.com")
        'Johndoe'
    """
    # Extract local part before @
    username = email.split('@')[0]
    
    # Remove digits
    name_part = re.sub(r'\d+', '', username)
    
    # Replace separators with spaces
    name_part = re.sub(r'[._+-]', ' ', name_part)
    
    # Handle camelCase: insert space before uppercase letters
    name = re.sub(r'([a-z])([A-Z])', r'\1 \2', name_part)
    
    # Title case and strip whitespace
    return name.title().strip() or "User"


def generate_github_username(email: str) -> str:
    """
    Generate a valid GitHub username from email address.
    
    GitHub username rules:
    - Only alphanumeric characters and hyphens
    - Cannot start or end with hyphen
    - Maximum 39 characters
    
    Args:
        email: Email address
        
    Returns:
        Valid GitHub username
        
    Example:
        >>> generate_github_username("john.doe@example.com")
        'johndoe'
        >>> generate_github_username("test_user+123@example.com")
        'testuser123'
    """
    # Extract local part of email
    local_part = email.split('@')[0]
    
    # Remove invalid characters (keep only alphanumeric and hyphens)
    username = re.sub(r'[^a-zA-Z0-9-]', '', local_part)
    
    # Remove leading/trailing hyphens
    username = username.strip('-')
    
    # Ensure it's not empty - use deterministic fallback based on email hash
    if not username:
        import hashlib
        # Create deterministic username from email hash
        email_hash = hashlib.md5(email.encode()).hexdigest()[:6]
        username = f'user{email_hash}'
    
    # Truncate to 39 characters
    username = username[:39]
    
    # Remove trailing hyphen if truncation created one
    username = username.rstrip('-')
    
    return username


def split_name(full_name: str) -> tuple[str, str]:
    """
    Split a full name into first and last name.
    
    Args:
        full_name: Full name string (e.g., "John Doe")
        
    Returns:
        Tuple of (first_name, last_name)
        
    Example:
        >>> split_name("John Doe")
        ('John', 'Doe')
        >>> split_name("John")
        ('John', 'User')
    """
    parts = full_name.strip().split(maxsplit=1)
    
    if len(parts) == 2:
        return parts[0], parts[1]
    elif len(parts) == 1:
        return parts[0], "User"
    else:
        return "User", "User"
