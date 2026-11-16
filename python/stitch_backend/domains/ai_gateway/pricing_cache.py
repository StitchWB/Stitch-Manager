"""Cached per-origin model prices for the pre-flight cost guard.

``/api/pricing`` is free and unauthenticated, so the table is fetched lazily
once per origin and reused for :data:`PRICING_TTL_SECONDS`.  Every failure is
swallowed: an unpriced model is a flag for the caller, never a request error.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

PRICING_TTL_SECONDS = 3600.0
QUOTA_PER_UNIT = 500_000.0
_QUOTA_UNIT_HINT = 1000.0

Fetcher = Callable[[str], Awaitable[dict[str, Any] | None]]


@dataclass(frozen=True)
class Price:
    quota_type: int = 0
    model_ratio: float = 0.0
    completion_ratio: float = 1.0
    model_price: float | None = None


@dataclass
class _OriginEntry:
    fetched_at: float
    models: dict[str, Price] = field(default_factory=dict)


def normalize_origin(base_url: str) -> str:
    origin = base_url.strip().rstrip("/")
    for marker in ("/v1beta", "/v1"):
        index = origin.find(marker)
        if index != -1:
            origin = origin[:index]
            break
    return origin.rstrip("/")


def estimate_usd(
    price: Price,
    prompt_tokens: int,
    completion_tokens: int,
    group_multiplier: float = 1.0,
) -> float:
    if price.quota_type == 1:
        raw = price.model_price or 0.0
        usd = raw / QUOTA_PER_UNIT if raw > _QUOTA_UNIT_HINT else raw
        return usd * group_multiplier
    tokens = (
        prompt_tokens * price.model_ratio
        + completion_tokens * price.model_ratio * price.completion_ratio
    )
    return tokens * group_multiplier / QUOTA_PER_UNIT


def _as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_pricing(payload: dict[str, Any]) -> dict[str, Price]:
    data = payload.get("data")
    if not isinstance(data, list):
        return {}
    models: dict[str, Price] = {}
    for item in data:
        if not isinstance(item, dict):
            continue
        name = item.get("model_name")
        if not isinstance(name, str) or not name:
            continue
        quota_type = item.get("quota_type")
        models[name] = Price(
            quota_type=int(quota_type) if isinstance(quota_type, int | float) else 0,
            model_ratio=_as_float(item.get("model_ratio"), 0.0),
            completion_ratio=_as_float(item.get("completion_ratio"), 1.0),
            model_price=_as_optional_float(item.get("model_price")),
        )
    return models


async def _fetch_default(origin: str) -> dict[str, Any] | None:
    from stitch_backend.domains.ai_gateway.adapters.configurable import ConfigurableAdapter

    return await ConfigurableAdapter().fetch_pricing(origin)


class PricingCache:
    def __init__(
        self,
        fetcher: Fetcher | None = None,
        *,
        ttl: float = PRICING_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._fetcher = fetcher or _fetch_default
        self._ttl = ttl
        self._clock = clock
        self._entries: dict[str, _OriginEntry] = {}
        self._inflight: dict[str, asyncio.Task[dict[str, Price] | None]] = {}

    async def price_for(self, origin: str, model: str) -> Price | None:
        models = await self._models(normalize_origin(origin), force=False)
        if models is None:
            return None
        return models.get(model)

    async def refresh(self, origin: str) -> dict[str, Price] | None:
        return await self._models(normalize_origin(origin), force=True)

    async def _models(self, origin: str, *, force: bool) -> dict[str, Price] | None:
        if not origin:
            return None
        if not force:
            entry = self._entries.get(origin)
            if entry is not None and self._clock() - entry.fetched_at < self._ttl:
                return entry.models
        task = self._inflight.get(origin)
        if task is None:
            task = asyncio.ensure_future(self._load(origin))
            self._inflight[origin] = task

            def _drop(_task: object, key: str = origin) -> None:
                self._inflight.pop(key, None)

            task.add_done_callback(_drop)
        try:
            return await task
        except Exception:
            logger.debug("pricing fetch failed for %s", origin, exc_info=True)
            return None

    async def _load(self, origin: str) -> dict[str, Price] | None:
        try:
            payload = await self._fetcher(origin)
        except Exception:
            logger.debug("pricing fetcher raised for %s", origin, exc_info=True)
            payload = None
        parsed = isinstance(payload, dict)
        models = _parse_pricing(payload) if isinstance(payload, dict) else {}
        self._entries[origin] = _OriginEntry(fetched_at=self._clock(), models=models)
        return models if parsed else None


_cache: PricingCache | None = None


def get_pricing_cache() -> PricingCache:
    global _cache
    if _cache is None:
        _cache = PricingCache()
    return _cache


__all__ = [
    "PRICING_TTL_SECONDS",
    "QUOTA_PER_UNIT",
    "Price",
    "PricingCache",
    "estimate_usd",
    "get_pricing_cache",
    "normalize_origin",
]
