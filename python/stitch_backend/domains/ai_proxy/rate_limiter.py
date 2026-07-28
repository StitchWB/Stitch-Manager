"""Per-key rate limiting."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


class RateLimiter:
    """Rate limiter для одного ключа."""

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window = timedelta(seconds=window_seconds)
        self.requests: list[datetime] = []
        self.lock = asyncio.Lock()

    async def can_use(self) -> bool:
        """Проверить можно ли использовать ключ."""
        async with self.lock:
            now = datetime.utcnow()

            # Удалить старые запросы
            self.requests = [
                t for t in self.requests
                if now - t < self.window
            ]

            return len(self.requests) < self.max_requests

    async def record(self):
        """Записать использование."""
        async with self.lock:
            self.requests.append(datetime.utcnow())

    @property
    def remaining(self) -> int:
        """Осталось запросов."""
        now = datetime.utcnow()
        active = [t for t in self.requests if now - t < self.window]
        return max(0, self.max_requests - len(active))


class KeyRateLimiter:
    """Менеджер rate limiters для всех ключей."""

    # Лимиты по провайдерам (requests per minute)
    DEFAULT_LIMITS: dict[str, tuple[int, int]] = {
        "openai": (60, 60),        # 60 req/min
        "anthropic": (50, 60),     # 50 req/min
        "gemini": (60, 60),        # 60 req/min
        "dashscope": (100, 60),    # 100 req/min
        "fireworks": (120, 60),    # 120 req/min
    }

    def __init__(self):
        self.limiters: dict[str, RateLimiter] = {}
        self.lock = asyncio.Lock()

    async def can_use(self, key_id: str, provider: str) -> bool:
        """Проверить можно ли использовать ключ."""
        async with self.lock:
            if key_id not in self.limiters:
                # Создать limiter для ключа
                max_req, window = self.DEFAULT_LIMITS.get(provider, (60, 60))
                self.limiters[key_id] = RateLimiter(max_req, window)

            return await self.limiters[key_id].can_use()

    async def record(self, key_id: str):
        """Записать использование."""
        if key_id in self.limiters:
            await self.limiters[key_id].record()

    def get_remaining(self, key_id: str) -> Optional[int]:
        """Получить оставшиеся запросы."""
        if key_id in self.limiters:
            return self.limiters[key_id].remaining
        return None


# Singleton instance
_rate_limiter: Optional[KeyRateLimiter] = None


def get_rate_limiter() -> KeyRateLimiter:
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = KeyRateLimiter()
    return _rate_limiter