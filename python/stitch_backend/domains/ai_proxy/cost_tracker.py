"""Cost tracking for API usage."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class ModelPricing:
    """Цены за 1K токенов (input, output) в USD."""
    input_price: float
    output_price: float


class CostTracker:
    """Трекер затрат для API ключей."""

    # Цены за 1K токенов (input, output) в USD
    PRICING: dict[str, ModelPricing] = {
        # OpenAI
        "gpt-4": ModelPricing(0.03, 0.06),
        "gpt-4-turbo": ModelPricing(0.01, 0.03),
        "gpt-4o": ModelPricing(0.005, 0.015),
        "gpt-3.5-turbo": ModelPricing(0.0005, 0.0015),

        # Anthropic
        "claude-3-opus": ModelPricing(0.015, 0.075),
        "claude-3-sonnet": ModelPricing(0.003, 0.015),
        "claude-3-haiku": ModelPricing(0.00025, 0.00125),
        "claude-3.5-sonnet": ModelPricing(0.003, 0.015),

        # Google
        "gemini-1.5-pro": ModelPricing(0.0035, 0.0105),
        "gemini-1.5-flash": ModelPricing(0.00035, 0.00105),

        # DashScope
        "qwen-max": ModelPricing(0.004, 0.012),
        "qwen-plus": ModelPricing(0.002, 0.006),
        "qwen-turbo": ModelPricing(0.001, 0.003),
    }

    def __init__(self):
        self.costs: dict[str, float] = {}  # key_id -> total_cost
        self.lock = asyncio.Lock()

    def get_pricing(self, model: str) -> Optional[ModelPricing]:
        """Получить цены для модели."""
        # Попробовать точное совпадение
        if model in self.PRICING:
            return self.PRICING[model]

        # Попробовать частичное совпадение
        for key, pricing in self.PRICING.items():
            if key in model:
                return pricing

        return None

    async def record_usage(
        self,
        key_id: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
    ):
        """Записать использование и рассчитать стоимость."""
        pricing = self.get_pricing(model)
        if pricing is None:
            logger.debug("No pricing found for model %s", model)
            return

        cost = (
            (input_tokens / 1000 * pricing.input_price)
            + (output_tokens / 1000 * pricing.output_price)
        )

        async with self.lock:
            self.costs[key_id] = self.costs.get(key_id, 0.0) + cost

    def get_cost(self, key_id: str) -> float:
        """Получить общую стоимость для ключа."""
        return self.costs.get(key_id, 0.0)

    def get_all_costs(self) -> dict[str, float]:
        """Получить стоимость для всех ключей."""
        return self.costs.copy()

    def get_total_cost(self) -> float:
        """Получить общую стоимость."""
        return sum(self.costs.values())


# Singleton instance
_cost_tracker: Optional[CostTracker] = None


def get_cost_tracker() -> CostTracker:
    global _cost_tracker
    if _cost_tracker is None:
        _cost_tracker = CostTracker()
    return _cost_tracker