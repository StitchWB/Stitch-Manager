"""Thread-safe TTL cache for expensive operations.

Provides both sync and async decorators for caching function results.
Supports cache invalidation for mutation operations.
"""

from __future__ import annotations

import time
from functools import wraps
from typing import Any, Callable, TypeVar

T = TypeVar("T")


class TTLCache:
    """Thread-safe TTL cache with a single entry."""

    def __init__(self, ttl_seconds: float = 60.0):
        self._ttl = ttl_seconds
        self._value: Any = None
        self._expires_at: float = 0.0

    def get(self) -> Any | None:
        """Return cached value if valid, else None."""
        if self._value is not None and time.monotonic() < self._expires_at:
            return self._value
        return None

    def set(self, value: Any) -> None:
        """Store value with TTL."""
        self._value = value
        self._expires_at = time.monotonic() + self._ttl

    def invalidate(self) -> None:
        """Clear the cache."""
        self._value = None
        self._expires_at = 0.0


class TTLCacheDict:
    """Thread-safe TTL cache with multiple keys."""

    def __init__(self, ttl_seconds: float = 60.0):
        self._ttl = ttl_seconds
        self._cache: dict[str, tuple[Any, float]] = {}

    def get(self, key: str) -> Any | None:
        """Return cached value if valid, else None."""
        if key in self._cache:
            value, expires_at = self._cache[key]
            if time.monotonic() < expires_at:
                return value
            del self._cache[key]
        return None

    def set(self, key: str, value: Any) -> None:
        """Store value with TTL."""
        self._cache[key] = (value, time.monotonic() + self._ttl)

    def invalidate(self, key: str | None = None) -> None:
        """Clear cache for a key or all keys."""
        if key is None:
            self._cache.clear()
        else:
            self._cache.pop(key, None)


def cached_sync(ttl_seconds: float = 60.0):
    """Decorator to cache sync function results with TTL."""
    cache = TTLCache(ttl_seconds)

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            result = cache.get()
            if result is not None:
                return result
            result = func(*args, **kwargs)
            cache.set(result)
            return result

        wrapper.invalidate_cache = cache.invalidate  # type: ignore[attr-defined]
        return wrapper

    return decorator


def cached_async(ttl_seconds: float = 60.0):
    """Decorator to cache async function results with TTL."""
    cache = TTLCache(ttl_seconds)

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            result = cache.get()
            if result is not None:
                return result
            result = await func(*args, **kwargs)
            cache.set(result)
            return result

        wrapper.invalidate_cache = cache.invalidate  # type: ignore[attr-defined]
        return wrapper

    return decorator
