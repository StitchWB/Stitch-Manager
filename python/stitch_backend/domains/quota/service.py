"""Quota management service — in-memory per-machine quota tracking.

Mirrors Rust ``services/quota_manager.rs``.

Tiers:
- Free: 50 requests/day, 100_000 tokens/day
- Pro: 500 requests/day, 2_000_000 tokens/day
- Enterprise: unlimited

State is stored in-memory (restart resets quotas).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

# Tier limits: (max_requests, max_tokens)
_TIER_LIMITS: dict[str, tuple[int, int]] = {
    "free": (50, 100_000),
    "pro": (500, 2_000_000),
    "enterprise": (999_999, 999_999_999),
}


@dataclass
class _MachineQuota:
    machine_id: str
    tier: str = "free"
    requests_today: int = 0
    tokens_today: int = 0
    day: str = ""  # YYYY-MM-DD to detect day rollover
    total_requests: int = 0
    total_tokens: int = 0


class QuotaManagerService:
    """In-memory quota manager — mirrors Rust QuotaManager."""

    def __init__(self) -> None:
        self._quotas: dict[str, _MachineQuota] = {}

    def _today(self) -> str:
        return time.strftime("%Y-%m-%d")

    def _get_or_create(self, machine_id: str) -> _MachineQuota:
        q = self._quotas.get(machine_id)
        if q is None:
            q = _MachineQuota(machine_id=machine_id, day=self._today())
            self._quotas[machine_id] = q
        # Day rollover check
        today = self._today()
        if q.day != today:
            q.requests_today = 0
            q.tokens_today = 0
            q.day = today
        return q

    def check_quota(self, machine_id: str, estimated_tokens: int = 0) -> dict[str, Any]:
        """Check if machine has sufficient quota."""
        q = self._get_or_create(machine_id)
        max_req, max_tok = _TIER_LIMITS.get(q.tier, _TIER_LIMITS["free"])
        allowed = q.requests_today < max_req and (q.tokens_today + estimated_tokens) < max_tok
        return {
            "allowed": allowed,
            "machineId": machine_id,
            "tier": q.tier,
            "requestsToday": q.requests_today,
            "tokensToday": q.tokens_today,
            "maxRequests": max_req,
            "maxTokens": max_tok,
            "remainingRequests": max(0, max_req - q.requests_today),
            "remainingTokens": max(0, max_tok - q.tokens_today),
        }

    def deduct_quota(self, machine_id: str, tokens_used: int) -> dict[str, Any]:
        """Deduct tokens from a machine's quota."""
        q = self._get_or_create(machine_id)
        q.requests_today += 1
        q.tokens_today += tokens_used
        q.total_requests += 1
        q.total_tokens += tokens_used
        max_req, max_tok = _TIER_LIMITS.get(q.tier, _TIER_LIMITS["free"])
        return {
            "success": True,
            "machineId": machine_id,
            "tokensDeducted": tokens_used,
            "requestsToday": q.requests_today,
            "tokensToday": q.tokens_today,
            "maxRequests": max_req,
            "maxTokens": max_tok,
        }

    def get_quota_info(self, machine_id: str) -> dict[str, Any]:
        """Get detailed quota information."""
        q = self._get_or_create(machine_id)
        max_req, max_tok = _TIER_LIMITS.get(q.tier, _TIER_LIMITS["free"])
        return {
            "machineId": machine_id,
            "tier": q.tier,
            "requestsToday": q.requests_today,
            "tokensToday": q.tokens_today,
            "maxRequests": max_req,
            "maxTokens": max_tok,
            "remainingRequests": max(0, max_req - q.requests_today),
            "remainingTokens": max(0, max_tok - q.tokens_today),
            "totalRequests": q.total_requests,
            "totalTokens": q.total_tokens,
            "day": q.day,
        }

    def reset_quota(self, machine_id: str) -> None:
        """Reset quota for a specific machine."""
        q = self._get_or_create(machine_id)
        q.requests_today = 0
        q.tokens_today = 0
        q.day = self._today()

    def set_tier(self, machine_id: str, tier: str) -> None:
        """Set the subscription tier for a machine."""
        tier = tier.lower()
        if tier not in _TIER_LIMITS:
            raise ValueError(f"Invalid tier: {tier}. Must be one of: {list(_TIER_LIMITS.keys())}")
        q = self._get_or_create(machine_id)
        q.tier = tier

    def reset_daily_quotas(self) -> int:
        """Reset all quotas from a previous day. Returns count of resets."""
        today = self._today()
        count = 0
        for q in self._quotas.values():
            if q.day != today:
                q.requests_today = 0
                q.tokens_today = 0
                q.day = today
                count += 1
        return count

    def get_storage_stats(self) -> dict[str, int]:
        """Get storage statistics."""
        tier_counts: dict[str, int] = {}
        for q in self._quotas.values():
            tier_counts[q.tier] = tier_counts.get(q.tier, 0) + 1
        return {
            "totalMachines": len(self._quotas),
            **tier_counts,
        }


# Singleton instance
_quota_manager = QuotaManagerService()


def get_quota_manager() -> QuotaManagerService:
    return _quota_manager
