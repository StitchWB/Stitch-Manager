"""Proxy stats counters: request/token/credit tracking with per-model breakdown.

Reference: _references/Kiro-account-manager/.../types.ts ProxyStats interface.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from stitch_backend.domains.kiro_gateway.translator.kiro_types import JsonObject


class ProxyStats:
    """Thread-safe-ish counters for proxy telemetry.

    Plain ints behind a lock — single-writer loops are fine without lock,
    but the lock protects snapshot() reads and multi-threaded access.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._start_time = time.time()

        # request counters
        self.total_requests = 0
        self.success_requests = 0
        self.failed_requests = 0

        # token counters
        self.input_tokens = 0
        self.output_tokens = 0
        self.cache_read_tokens = 0
        self.cache_write_tokens = 0
        self.reasoning_tokens = 0

        # credits
        self.total_credits = 0.0

        # per-model breakdown
        self._model_requests: dict[str, int] = defaultdict(int)
        self._model_tokens: dict[str, int] = defaultdict(int)

    # ── record methods ────────────────────────────────────────────────────

    def record_request(self, *, success: bool = True) -> None:
        with self._lock:
            self.total_requests += 1
            if success:
                self.success_requests += 1
            else:
                self.failed_requests += 1

    def record_tokens(
        self,
        *,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_read: int = 0,
        cache_write: int = 0,
        reasoning: int = 0,
        credits: float = 0.0,
        model: str = "",
    ) -> None:
        with self._lock:
            self.input_tokens += input_tokens
            self.output_tokens += output_tokens
            self.cache_read_tokens += cache_read
            self.cache_write_tokens += cache_write
            self.reasoning_tokens += reasoning
            self.total_credits += credits
            if model:
                self._model_requests[model] += 1
                self._model_tokens[model] += input_tokens + output_tokens

    # ── snapshot ──────────────────────────────────────────────────────────

    def snapshot(self) -> JsonObject:
        with self._lock:
            return {
                "total_requests": self.total_requests,
                "success_requests": self.success_requests,
                "failed_requests": self.failed_requests,
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "cache_read_tokens": self.cache_read_tokens,
                "cache_write_tokens": self.cache_write_tokens,
                "reasoning_tokens": self.reasoning_tokens,
                "total_credits": self.total_credits,
                "uptime_s": round(time.time() - self._start_time, 1),
                "models": {
                    model: {"requests": reqs, "tokens": self._model_tokens[model]}
                    for model, reqs in sorted(self._model_requests.items())
                },
            }

    # ── reset ─────────────────────────────────────────────────────────────

    def reset(self) -> None:
        with self._lock:
            self._start_time = time.time()
            self.total_requests = 0
            self.success_requests = 0
            self.failed_requests = 0
            self.input_tokens = 0
            self.output_tokens = 0
            self.cache_read_tokens = 0
            self.cache_write_tokens = 0
            self.reasoning_tokens = 0
            self.total_credits = 0.0
            self._model_requests.clear()
            self._model_tokens.clear()
