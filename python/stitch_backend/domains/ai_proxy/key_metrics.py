"""Key metrics tracking and adaptive routing."""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class KeyMetrics:
    """Метрики для одного API ключа."""
    key_id: str
    provider: str
    usage_count: int = 0
    success_count: int = 0
    error_count: int = 0
    total_latency: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    last_used: Optional[float] = None
    last_error: Optional[str] = None
    last_error_time: Optional[float] = None

    @property
    def success_rate(self) -> float:
        if self.usage_count == 0:
            return 1.0
        return self.success_count / self.usage_count

    @property
    def avg_latency(self) -> float:
        if self.usage_count == 0:
            return 0.0
        return self.total_latency / self.usage_count

    @property
    def total_tokens(self) -> int:
        return self.total_input_tokens + self.total_output_tokens

    def to_dict(self) -> dict:
        return {
            "keyId": self.key_id,
            "provider": self.provider,
            "usageCount": self.usage_count,
            "successCount": self.success_count,
            "errorCount": self.error_count,
            "successRate": round(self.success_rate, 3),
            "avgLatency": round(self.avg_latency, 2),
            "totalInputTokens": self.total_input_tokens,
            "totalOutputTokens": self.total_output_tokens,
            "totalTokens": self.total_tokens,
            "lastUsed": self.last_used,
            "lastError": self.last_error,
            "lastErrorTime": self.last_error_time,
        }


class KeyMetricsTracker:
    """Централизованный трекер метрик для всех ключей."""

    def __init__(self):
        self.metrics: dict[str, KeyMetrics] = {}
        self.lock = asyncio.Lock()

    async def record_success(
        self,
        key_id: str,
        provider: str,
        latency: float,
        input_tokens: int = 0,
        output_tokens: int = 0,
    ):
        """Записать успешный запрос."""
        async with self.lock:
            if key_id not in self.metrics:
                self.metrics[key_id] = KeyMetrics(key_id=key_id, provider=provider)

            m = self.metrics[key_id]
            m.usage_count += 1
            m.success_count += 1
            m.total_latency += latency
            m.total_input_tokens += input_tokens
            m.total_output_tokens += output_tokens
            m.last_used = time.time()

    async def record_error(self, key_id: str, provider: str, error: str):
        """Записать ошибку."""
        async with self.lock:
            if key_id not in self.metrics:
                self.metrics[key_id] = KeyMetrics(key_id=key_id, provider=provider)

            m = self.metrics[key_id]
            m.usage_count += 1
            m.error_count += 1
            m.last_error = error
            m.last_error_time = time.time()
            m.last_used = time.time()

    def get_metrics(self, key_id: str) -> Optional[KeyMetrics]:
        """Получить метрики для ключа."""
        return self.metrics.get(key_id)

    def get_all_metrics(self) -> list[dict]:
        """Получить метрики для всех ключей."""
        return [m.to_dict() for m in self.metrics.values()]

    def get_provider_metrics(self, provider: str) -> list[dict]:
        """Получить метрики для провайдера."""
        return [
            m.to_dict()
            for m in self.metrics.values()
            if m.provider == provider
        ]


# Singleton instance
_metrics_tracker: Optional[KeyMetricsTracker] = None


def get_metrics_tracker() -> KeyMetricsTracker:
    global _metrics_tracker
    if _metrics_tracker is None:
        _metrics_tracker = KeyMetricsTracker()
    return _metrics_tracker