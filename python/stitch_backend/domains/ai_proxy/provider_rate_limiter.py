from __future__ import annotations

import asyncio
import math
import time
from collections import deque
from dataclasses import dataclass, field

from fastapi import HTTPException

from stitch_backend.domains.background_manager.schemas import (
    BackgroundManagerConfig,
    RateLimitPolicy,
)

_DEFAULT_MAX_WAIT_SECONDS = 30.0


@dataclass(slots=True)
class _RequestReservation:
    reservation_id: int
    timestamp: float


@dataclass(slots=True)
class _TokenReservation:
    reservation_id: int
    timestamp: float
    tokens: int


@dataclass(slots=True)
class _ProviderWindow:
    requests: deque[_RequestReservation] = field(default_factory=deque)
    tokens: deque[_TokenReservation] = field(default_factory=deque)


@dataclass(frozen=True, slots=True)
class AdmissionTicket:
    provider: str
    reservation_id: int


class ProviderRateLimiter:
    """Concurrency-safe provider-level admission with independent sliding windows."""

    def __init__(self, *, max_wait_seconds: float = _DEFAULT_MAX_WAIT_SECONDS) -> None:
        if max_wait_seconds < 0:
            raise ValueError("max_wait_seconds must be non-negative")
        self._max_wait_seconds = max_wait_seconds
        self._lock = asyncio.Lock()
        self._windows: dict[str, _ProviderWindow] = {}
        self._next_reservation_id = 0

    async def acquire(
        self,
        provider: str,
        estimated_tokens: int,
        config: BackgroundManagerConfig,
    ) -> AdmissionTicket | None:
        policy = _provider_policy(provider, config)
        if not config.rate_limit_enabled or policy is None:
            return None

        provider_key = provider.casefold()
        estimated_tokens = max(1, estimated_tokens)
        rpm_limit = _effective_limit(
            policy.rpm_limit, config.rate_limit_reserve_percent
        )
        tpm_limit = _effective_limit(
            policy.tpm_limit, config.rate_limit_reserve_percent
        )
        if rpm_limit < 1 or tpm_limit < 1:
            raise _rate_limit_error(
                provider, "all configured capacity is reserved", retry_after=0.0
            )
        if estimated_tokens > tpm_limit:
            raise _rate_limit_error(
                provider,
                f"estimated request size {estimated_tokens} exceeds available token capacity {tpm_limit}",
                retry_after=0.0,
            )

        deadline = time.monotonic() + self._max_wait_seconds
        while True:
            async with self._lock:
                now = time.monotonic()
                window = self._windows.setdefault(provider_key, _ProviderWindow())
                self._purge(window, policy, now)
                token_total = sum(entry.tokens for entry in window.tokens)
                if (
                    len(window.requests) < rpm_limit
                    and token_total + estimated_tokens <= tpm_limit
                ):
                    self._next_reservation_id += 1
                    reservation_id = self._next_reservation_id
                    window.requests.append(_RequestReservation(reservation_id, now))
                    window.tokens.append(
                        _TokenReservation(reservation_id, now, estimated_tokens)
                    )
                    return AdmissionTicket(provider_key, reservation_id)

                retry_after = self._next_delay(
                    window,
                    policy,
                    now,
                    rpm_limit,
                    tpm_limit,
                    estimated_tokens,
                )

            remaining = deadline - time.monotonic()
            if remaining <= 0 or retry_after > remaining:
                raise _rate_limit_error(
                    provider,
                    "provider rate limit is exhausted",
                    retry_after=max(0.0, retry_after),
                )
            await asyncio.sleep(max(0.001, min(retry_after, remaining)))

    async def reconcile(
        self, ticket: AdmissionTicket | None, actual_tokens: int | None
    ) -> None:
        if ticket is None or actual_tokens is None:
            return
        async with self._lock:
            window = self._windows.get(ticket.provider)
            if window is None:
                return
            for entry in window.tokens:
                if entry.reservation_id == ticket.reservation_id:
                    entry.tokens = max(0, actual_tokens)
                    return

    async def rollback(
        self,
        ticket: AdmissionTicket | None,
        *,
        release_request: bool = False,
    ) -> None:
        """Release token capacity; optionally release RPM when no dispatch occurred."""
        if ticket is None:
            return
        async with self._lock:
            window = self._windows.get(ticket.provider)
            if window is None:
                return
            window.tokens = deque(
                entry
                for entry in window.tokens
                if entry.reservation_id != ticket.reservation_id
            )
            if release_request:
                window.requests = deque(
                    entry
                    for entry in window.requests
                    if entry.reservation_id != ticket.reservation_id
                )

    @staticmethod
    def _purge(
        window: _ProviderWindow, policy: RateLimitPolicy, now: float
    ) -> None:
        rpm_cutoff = now - policy.rpm_window_seconds
        while window.requests and window.requests[0].timestamp <= rpm_cutoff:
            window.requests.popleft()
        tpm_cutoff = now - policy.tpm_window_seconds
        while window.tokens and window.tokens[0].timestamp <= tpm_cutoff:
            window.tokens.popleft()

    @staticmethod
    def _next_delay(
        window: _ProviderWindow,
        policy: RateLimitPolicy,
        now: float,
        rpm_limit: int,
        tpm_limit: int,
        estimated_tokens: int,
    ) -> float:
        delays: list[float] = []
        if len(window.requests) >= rpm_limit:
            delays.append(
                window.requests[0].timestamp + policy.rpm_window_seconds - now
            )

        token_total = sum(entry.tokens for entry in window.tokens)
        excess = token_total + estimated_tokens - tpm_limit
        if excess > 0:
            released = 0
            for entry in window.tokens:
                released += entry.tokens
                if released >= excess:
                    delays.append(
                        entry.timestamp + policy.tpm_window_seconds - now
                    )
                    break
        return max(0.001, max(delays, default=0.001))


def _provider_policy(
    provider: str, config: BackgroundManagerConfig
) -> RateLimitPolicy | None:
    provider_key = provider.casefold()
    return next(
        (
            policy
            for policy in config.rate_limit_policies
            if policy.provider.casefold() == provider_key
        ),
        None,
    )


def _effective_limit(limit: int, reserve_percent: int) -> int:
    return math.floor(limit * (100 - reserve_percent) / 100)


def _rate_limit_error(
    provider: str, message: str, *, retry_after: float
) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail={
            "error": {
                "code": "rate_limit_exceeded",
                "provider": provider,
                "message": message,
                "retryAfterSeconds": round(retry_after, 3),
            }
        },
    )
