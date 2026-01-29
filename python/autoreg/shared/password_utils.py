"""Password generation utilities for account registration."""

import random
import string


def generate_secure_password(length: int = 16) -> str:
    """
    Generate a secure random password with guaranteed character diversity.

    Args:
        length: Total password length (minimum 4 to ensure all character types)

    Returns:
        A random password containing at least one uppercase, lowercase, digit, and special character

    Example:
        >>> password = generate_secure_password(16)
        >>> len(password)
        16
    """
    if length < 4:
        raise ValueError("Password length must be at least 4 to ensure character diversity")

    # Character sets
    chars = string.ascii_letters + string.digits + "!@#$%^&*"
    special_chars = "!@#$%^&*"

    # Ensure at least one of each required character type
    password = [
        random.choice(string.ascii_uppercase),
        random.choice(string.ascii_lowercase),
        random.choice(string.digits),
        random.choice(special_chars),
    ]

    # Fill remaining length with random characters from full set
    password += [random.choice(chars) for _ in range(length - 4)]

    # Shuffle to avoid predictable patterns
    random.shuffle(password)

    return ''.join(password)
