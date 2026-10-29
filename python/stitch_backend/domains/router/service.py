"""Provider Router service — regex-based model→provider routing with cache.

Ported from Rust ``services/provider_router.rs``.
Routes LLM model IDs to appropriate providers (Kiro, Bedrock, Anthropic, OpenAI).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


# ── Routing rules (same as Rust) ──────────────────────────────────────────────

@dataclass
class RoutingRule:
    pattern: str
    provider: str
    fallback: str | None
    description: str
    _regex: re.Pattern | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        try:
            self._regex = re.compile(self.pattern)
        except re.error:
            self._regex = None

    def matches(self, model_id: str) -> bool:
        return self._regex is not None and self._regex.search(model_id) is not None


_DEFAULT_RULES: list[RoutingRule] = [
    RoutingRule(
        pattern=r"^anthropic\.",
        provider="kiro", fallback="bedrock",
        description="Anthropic namespaced models → Kiro (fallback Bedrock)",
    ),
    RoutingRule(
        pattern=r"^amazon\.",
        provider="bedrock", fallback=None,
        description="Amazon/Bedrock models → Bedrock",
    ),
    RoutingRule(
        pattern=r"^claude-",
        provider="anthropic", fallback="kiro",
        description="Claude models → Anthropic API (fallback Kiro)",
    ),
    RoutingRule(
        pattern=r"^gpt-|^o[0-9]",
        provider="openai", fallback=None,
        description="GPT/o-series models → OpenAI API",
    ),
]


# ── Simple LRU-like cache ─────────────────────────────────────────────────────

_CACHE_CAPACITY = 256
_cache: dict[str, dict[str, Any]] = {}
_cache_hits = 0
_cache_misses = 0


def _cache_get(key: str) -> dict[str, Any] | None:
    global _cache_hits
    val = _cache.get(key)
    if val is not None:
        _cache_hits += 1
    return val


def _cache_set(key: str, value: dict[str, Any]) -> None:
    global _cache_misses
    if len(_cache) >= _CACHE_CAPACITY:
        # Evict oldest
        oldest = next(iter(_cache))
        del _cache[oldest]
    _cache[key] = value


# ── Public API ────────────────────────────────────────────────────────────────

def route_provider(model_id: str) -> str:
    """Route a model ID to the primary provider name."""
    result = _resolve(model_id)
    return result.get("provider") or "unknown"


def route_provider_with_fallback(model_id: str) -> dict[str, Any]:
    """Route a model ID and return primary + fallback."""
    return _resolve(model_id)


def get_routing_rules() -> list[dict[str, Any]]:
    """Return the list of routing rules."""
    return [
        {
            "pattern": r.pattern,
            "provider": r.provider,
            "fallback": r.fallback,
            "description": r.description,
        }
        for r in _DEFAULT_RULES
    ]


def clear_route_cache() -> None:
    """Clear the route result cache."""
    global _cache_hits, _cache_misses
    _cache.clear()
    _cache_hits = 0
    _cache_misses = 0


def get_cache_stats() -> dict[str, Any]:
    """Return cache statistics."""
    return {
        "size": len(_cache),
        "capacity": _CACHE_CAPACITY,
        "enabled": True,
        "hits": _cache_hits,
        "misses": _cache_misses,
    }


# ── Internal ──────────────────────────────────────────────────────────────────

def _resolve(model_id: str) -> dict[str, Any]:
    model_id = (model_id or "").strip()
    if not model_id:
        return {"modelId": "", "provider": None, "fallback": None, "matched": False}

    cached = _cache_get(model_id)
    if cached is not None:
        return cached

    for rule in _DEFAULT_RULES:
        if rule.matches(model_id):
            result = {
                "modelId": model_id,
                "provider": rule.provider,
                "fallback": rule.fallback,
                "matched": True,
            }
            _cache_set(model_id, result)
            return result

    result = {"modelId": model_id, "provider": None, "fallback": None, "matched": False}
    _cache_set(model_id, result)
    return result
