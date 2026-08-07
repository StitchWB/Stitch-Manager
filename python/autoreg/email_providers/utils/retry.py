"""
Retry utility with exponential backoff.

Provides decorator and function for retrying operations with configurable
backoff strategy.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from functools import wraps
from typing import TypeVar

logger = logging.getLogger(__name__)
T = TypeVar('T')


def retry_with_backoff(
    func: Callable[[], T],
    max_retries: int = 3,
    initial_delay: float = 1.0,
    max_delay: float = 30.0,
    backoff_factor: float = 2.0,
    retryable_exceptions: tuple = (Exception,)
) -> T:
    """
    Retry function with exponential backoff.

    Args:
        func: Function to retry (must take no arguments)
        max_retries: Maximum number of retry attempts
        initial_delay: Initial delay in seconds
        max_delay: Maximum delay in seconds
        backoff_factor: Multiplier for delay after each retry
        retryable_exceptions: Tuple of exceptions to retry on

    Returns:
        Result of successful function call

    Raises:
        Exception: Last exception if all retries exhausted

    Example:
        >>> result = retry_with_backoff(
        ...     lambda: api_call(),
        ...     max_retries=3,
        ...     initial_delay=1.0
        ... )
    """
    delay = initial_delay
    last_exception = None

    for attempt in range(max_retries):
        try:
            result = func()
            if attempt > 0:
                logger.info(f"Retry succeeded on attempt {attempt + 1}")
            return result

        except retryable_exceptions as e:
            last_exception = e

            if attempt == max_retries - 1:
                logger.error(
                    f"All {max_retries} retry attempts exhausted: {e}",
                    exc_info=True
                )
                raise

            logger.warning(
                f"Attempt {attempt + 1}/{max_retries} failed: {e}, "
                f"retrying in {delay:.1f}s"
            )
            time.sleep(delay)
            delay = min(delay * backoff_factor, max_delay)

    # Should not reach here, but for type safety
    if last_exception:
        raise last_exception
    raise RuntimeError("Retry logic error: no exception but no result")


def with_retry(
    max_retries: int = 3,
    initial_delay: float = 1.0,
    max_delay: float = 30.0,
    backoff_factor: float = 2.0,
    retryable_exceptions: tuple = (Exception,)
):
    """
    Decorator for retrying functions with exponential backoff.

    Args:
        max_retries: Maximum number of retry attempts
        initial_delay: Initial delay in seconds
        max_delay: Maximum delay in seconds
        backoff_factor: Multiplier for delay after each retry
        retryable_exceptions: Tuple of exceptions to retry on

    Example:
        >>> @with_retry(max_retries=3, initial_delay=1.0)
        ... def fetch_data():
        ...     return api_call()
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            return retry_with_backoff(
                lambda: func(*args, **kwargs),
                max_retries=max_retries,
                initial_delay=initial_delay,
                max_delay=max_delay,
                backoff_factor=backoff_factor,
                retryable_exceptions=retryable_exceptions
            )
        return wrapper
    return decorator
