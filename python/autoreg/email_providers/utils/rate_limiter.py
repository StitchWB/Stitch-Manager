"""
Rate limiting handler for API requests.

Provides decorator for handling HTTP 429 responses with automatic retry.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from functools import wraps

logger = logging.getLogger(__name__)


class RateLimitError(Exception):
    """
    Rate limit exceeded exception.

    Attributes:
        retry_after: Seconds to wait before retrying
    """

    def __init__(self, retry_after: int):
        self.retry_after = retry_after
        super().__init__(f"Rate limit exceeded, retry after {retry_after}s")


def handle_rate_limit(max_retries: int = 3):
    """
    Decorator for handling rate limiting (HTTP 429).

    Automatically retries requests that receive 429 responses,
    respecting the Retry-After header.

    Args:
        max_retries: Maximum number of retry attempts

    Returns:
        Decorated function that handles rate limiting

    Raises:
        RateLimitError: If rate limit persists after all retries
        requests.HTTPError: For other HTTP errors

    Example:
        >>> @handle_rate_limit(max_retries=3)
        ... def fetch_data():
        ...     response = requests.get(url)
        ...     response.raise_for_status()
        ...     return response.json()
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Import here to avoid circular dependency
            try:
                import requests
            except ImportError:
                logger.warning("requests library not available, rate limiting disabled")
                return func(*args, **kwargs)

            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)

                except requests.HTTPError as e:
                    if e.response is None:
                        raise

                    if e.response.status_code == 429:
                        # Extract retry-after header
                        retry_after = int(e.response.headers.get('Retry-After', 60))

                        if attempt < max_retries - 1:
                            logger.warning(
                                f"Rate limited (attempt {attempt + 1}/{max_retries}), "
                                f"waiting {retry_after}s"
                            )
                            time.sleep(retry_after)
                            continue
                        else:
                            logger.error(
                                f"Rate limit persists after {max_retries} attempts"
                            )
                            raise RateLimitError(retry_after) from None
                    else:
                        # Not a rate limit error, re-raise
                        raise

            raise RuntimeError("Should not reach here")

        return wrapper
    return decorator


def wait_for_rate_limit(retry_after: int, max_wait: int = 300):
    """
    Wait for rate limit to expire.

    Args:
        retry_after: Seconds to wait
        max_wait: Maximum seconds to wait (raises if exceeded)

    Raises:
        RateLimitError: If retry_after exceeds max_wait
    """
    if retry_after > max_wait:
        raise RateLimitError(retry_after)

    logger.info(f"Waiting {retry_after}s for rate limit to expire")
    time.sleep(retry_after)
