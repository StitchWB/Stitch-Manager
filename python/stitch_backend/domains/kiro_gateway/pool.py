"""AccountPool — strategies, circuit breaker, suspension detection.

Port of ``_references/Kiro-account-manager/…/accountPool.ts``.
Pool stores NO tokens and never calls Kiro — token refresh goes through the
accounts-domain service.  Accounts are supplied as immutable snapshots.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from enum import Enum

# ── Error classification ────────────────────────────────────────────────────


class ErrorType(Enum):
    """Whether a request failure is the client's fault or the account's."""

    FATAL = "fatal"  # request problem → return to client, don't switch
    RECOVERABLE = "recoverable"  # account problem → switch to next account


# Patterns that indicate the account itself is suspended (not just rate-limited).
# Ported from the reference's suspension detection logic.
_SUSPENSION_PATTERNS: tuple[str, ...] = (
    "TEMPORARILY_SUSPENDED",
    "AccountSuspendedException",
)


def classify_error(status_code: int, reason: str | None = None) -> ErrorType:
    """Classify an HTTP error as FATAL (request) or RECOVERABLE (account).

    Ported from the TypeScript reference.  Quota/rate-limit/billing errors
    are RECOVERABLE because a different account may have quota left.
    """
    # RECOVERABLE: quota / billing
    if status_code == 402:
        return ErrorType.RECOVERABLE
    # RECOVERABLE: token expired / invalid
    if status_code == 403:
        return ErrorType.RECOVERABLE
    # RECOVERABLE: rate limited
    if status_code == 429:
        return ErrorType.RECOVERABLE
    # 400: context overflow is FATAL (all accounts fail)
    if status_code == 400:
        if reason == "CONTENT_LENGTH_EXCEEDS_THRESHOLD":
            return ErrorType.FATAL
        return ErrorType.FATAL
    # 422: malformed request
    if status_code == 422:
        return ErrorType.FATAL
    # 5xx: server error
    if status_code >= 500:
        return ErrorType.FATAL
    return ErrorType.FATAL


def _is_suspension_reason(reason: str | None) -> bool:
    """Check whether *reason* signals a Kiro backend suspension."""
    if reason is None:
        return False
    upper = reason.upper()
    return any(p.upper() in upper for p in _SUSPENSION_PATTERNS)


# ── Account snapshot ─────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class AccountSnapshot:
    """Immutable snapshot of a Kiro account for the pool.

    The pool never stores tokens — token refresh is delegated to the accounts
    domain service.  Circuit-breaker and suspension state live in the pool's
    mutable internal dicts (persisted back via service.py).
    """

    id: str
    email: str
    access_token: str
    refresh_token: str | None = None
    profile_arn: str | None = None
    machine_id: str | None = None
    expires_at: float | None = None  # unix ms

    # Pool-internal mutable state (set by pool, not by snapshot)
    _error_count: int = field(default=0, repr=False)
    _last_used: float = field(default=0.0, repr=False)  # unix ms
    _cooldown_until: float = field(default=0.0, repr=False)  # unix ms
    _quota_exhausted_at: float = field(default=0.0, repr=False)  # unix ms
    _quota_reset_at: float = field(default=0.0, repr=False)  # unix ms
    _suspended_at: float = field(default=0.0, repr=False)  # unix ms
    _suspend_reason: str | None = field(default=None, repr=False)


# ── Pool configuration ───────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class AccountPoolConfig:
    base_cooldown_ms: float = 60_000  # 60s
    max_backoff_multiplier: float = 1440  # max 1440x = 24h
    quota_reset_ms: float = 3_600_000  # 1h
    probabilistic_retry_chance: float = 0.1  # 10%


class AccountSelectionStrategy(Enum):
    ROUND_ROBIN = "round-robin"
    STICKY = "sticky"


# ── Helpers ──────────────────────────────────────────────────────────────────


def _now_ms() -> float:
    # ponytail: time.time() is fine for circuit-breaker cooldowns; monotonic for
    # wall-clock-independent work, add when needed.
    return time.time() * 1000


def _replace(snapshot: AccountSnapshot, **kwargs: object) -> AccountSnapshot:
    """Return a new snapshot with the given fields replaced."""
    return AccountSnapshot(
        id=snapshot.id,
        email=snapshot.email,
        access_token=snapshot.access_token,
        refresh_token=snapshot.refresh_token,
        profile_arn=snapshot.profile_arn,
        machine_id=snapshot.machine_id,
        expires_at=snapshot.expires_at,
        _error_count=kwargs.get("_error_count", snapshot._error_count),  # type: ignore[arg-type]
        _last_used=kwargs.get("_last_used", snapshot._last_used),  # type: ignore[arg-type]
        _cooldown_until=kwargs.get("_cooldown_until", snapshot._cooldown_until),  # type: ignore[arg-type]
        _quota_exhausted_at=kwargs.get("_quota_exhausted_at", snapshot._quota_exhausted_at),  # type: ignore[arg-type]
        _quota_reset_at=kwargs.get("_quota_reset_at", snapshot._quota_reset_at),  # type: ignore[arg-type]
        _suspended_at=kwargs.get("_suspended_at", snapshot._suspended_at),  # type: ignore[arg-type]
        _suspend_reason=kwargs.get("_suspend_reason", snapshot._suspend_reason),  # type: ignore[arg-type]
    )


# ── AccountPool ──────────────────────────────────────────────────────────────


class AccountPool:
    """Multi-account pool with circuit breaker, suspension, and strategies.

    Ported from the TypeScript reference.  The pool works on immutable
    :class:`AccountSnapshot` objects — it never stores tokens or calls Kiro.
    """

    def __init__(self, config: AccountPoolConfig | None = None) -> None:
        self._accounts: dict[str, AccountSnapshot] = {}
        self._config = config or AccountPoolConfig()
        self._current_index: int = 0
        self._strategy: AccountSelectionStrategy = AccountSelectionStrategy.ROUND_ROBIN

    # ── Strategy ──────────────────────────────────────────────────────────

    @property
    def strategy(self) -> AccountSelectionStrategy:
        return self._strategy

    @strategy.setter
    def strategy(self, value: AccountSelectionStrategy) -> None:
        self._strategy = value

    # ── CRUD ──────────────────────────────────────────────────────────────

    def add_account(self, snapshot: AccountSnapshot) -> None:
        """Register an account snapshot.  Preserves suspension state."""
        self._accounts[snapshot.id] = snapshot

    def remove_account(self, account_id: str) -> None:
        self._accounts.pop(account_id, None)

    def get_account(self, account_id: str) -> AccountSnapshot | None:
        return self._accounts.get(account_id)

    def get_all_accounts(self) -> list[AccountSnapshot]:
        return list(self._accounts.values())

    @property
    def size(self) -> int:
        return len(self._accounts)

    @property
    def available_count(self) -> int:
        """Count of available accounts (probabilistic retry disabled — deterministic)."""
        now = _now_ms()
        count = 0
        for acc in self._accounts.values():
            if self._is_account_available(acc, now, allow_probabilistic_retry=False):
                count += 1
        return count

    # ── Suspension ─────────────────────────────────────────────────────────

    def is_suspended(self, snapshot: AccountSnapshot) -> bool:
        """Check if the account is suspended by the Kiro backend."""
        return snapshot._suspended_at > 0

    def mark_suspended(self, account_id: str, reason: str) -> bool:
        """Mark an account as suspended (skipped until cleared)."""
        acc = self._accounts.get(account_id)
        if acc is None:
            return False
        if self.is_suspended(acc) and acc._suspend_reason == reason:
            return False  # already marked with same reason
        self._accounts[account_id] = _replace(acc, _suspended_at=_now_ms(), _suspend_reason=reason)
        return True

    def clear_suspended(self, account_id: str) -> None:
        """Clear suspension so the account is available again."""
        acc = self._accounts.get(account_id)
        if acc is None or not self.is_suspended(acc):
            return
        self._accounts[account_id] = _replace(
            acc,
            _suspended_at=0.0,
            _suspend_reason=None,
            _error_count=0,
        )

    def _is_quota_exhausted(self, snapshot: AccountSnapshot, now: float) -> bool:
        """Check if the account has exhausted its quota window."""
        if snapshot._quota_reset_at > 0 and snapshot._quota_reset_at <= now:
            return False
        if snapshot._quota_exhausted_at > 0:
            return True
        return False

    # ── Selection ──────────────────────────────────────────────────────────

    def get_next_account(self, exclude_ids: set[str] | None = None) -> AccountSnapshot | None:
        """Return the next available account per the active strategy.

        Single-account pools bypass the circuit breaker (let the user see the
        real API error).  Multi-account pools apply all filters.
        """
        exclude = exclude_ids or set()
        account_list = list(self._accounts.values())
        if not account_list:
            return None

        # Single account: bypass circuit breaker
        if len(account_list) == 1:
            acc = account_list[0]
            return None if acc.id in exclude else acc

        now = _now_ms()
        start = self._current_index
        for i in range(len(account_list)):
            idx = (start + i) % len(account_list)
            acc = account_list[idx]
            if acc.id in exclude:
                continue
            if self._is_account_available(acc, now):
                return acc

        # No available account — check if all exhausted
        candidates = [a for a in account_list if a.id not in exclude]
        if candidates and all(self._is_quota_exhausted(a, now) for a in candidates):
            return None

        # Return the one with the shortest cooldown
        non_exhausted = [a for a in candidates if not self._is_quota_exhausted(a, now)]
        return self._shortest_cooldown(non_exhausted, now)

    def _shortest_cooldown(
        self, accounts: list[AccountSnapshot], now: float
    ) -> AccountSnapshot | None:
        best: AccountSnapshot | None = None
        shortest = float("inf")
        for acc in accounts:
            wait = max(0.0, acc._cooldown_until - now)
            if wait < shortest:
                shortest = wait
                best = acc
        return best

    # ── Recording ──────────────────────────────────────────────────────────

    def record_success(self, account_id: str) -> None:
        """Reset circuit breaker and advance the strategy pointer."""
        acc = self._accounts.get(account_id)
        if acc is None:
            return
        self._accounts[account_id] = _replace(
            acc, _error_count=0, _last_used=_now_ms(),
        )
        keys = list(self._accounts.keys())
        if account_id in keys and keys:
            idx = keys.index(account_id)
            if self._strategy == AccountSelectionStrategy.STICKY:
                self._current_index = idx
            else:
                self._current_index = (idx + 1) % len(keys)

    def record_error(
        self,
        account_id: str,
        error_type: ErrorType = ErrorType.RECOVERABLE,
        status_code: int | None = None,
    ) -> None:
        """Record a failure; FATAL errors don't count against the account."""
        acc = self._accounts.get(account_id)
        if acc is None:
            return
        now = _now_ms()

        if error_type == ErrorType.FATAL:
            return  # request problem, not account problem

        new_count = acc._error_count + 1
        quota_exhausted_at = acc._quota_exhausted_at
        quota_reset_at = acc._quota_reset_at

        # Quota errors (402/429) → mark exhausted with auto-reset window
        if status_code in (402, 429):
            quota_exhausted_at = now
            if not quota_reset_at or quota_reset_at <= now:
                quota_reset_at = now + self._config.quota_reset_ms

        self._accounts[account_id] = _replace(
            acc,
            _error_count=new_count,
            _last_used=now,
            _quota_exhausted_at=quota_exhausted_at,
            _quota_reset_at=quota_reset_at,
        )

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def reset(self) -> None:
        """Reset all accounts to available (clear circuit breaker + suspension)."""
        for aid, acc in list(self._accounts.items()):
            self._accounts[aid] = _replace(
                acc,
                _error_count=0,
                _cooldown_until=0.0,
                _quota_exhausted_at=0.0,
                _suspended_at=0.0,
                _suspend_reason=None,
            )
        self._current_index = 0

    def clear(self) -> None:
        """Remove all accounts."""
        self._accounts.clear()
        self._current_index = 0

    def _is_account_available(
        self,
        snapshot: AccountSnapshot,
        now: float,
        *,
        allow_probabilistic_retry: bool = True,
    ) -> bool:
        """Full availability check: suspension → quota → token → circuit breaker."""
        if self.is_suspended(snapshot):
            return False
        if self._is_quota_exhausted(snapshot, now):
            return False
        # Token expired with no refresh token → unusable
        if snapshot.expires_at and snapshot.expires_at < now and not snapshot.refresh_token:
            return False

        failures = snapshot._error_count
        if failures > 0 and snapshot._last_used > 0:
            time_since = now - snapshot._last_used
            backoff = min(2 ** (failures - 1), self._config.max_backoff_multiplier)
            effective = self._config.base_cooldown_ms * backoff

            if time_since < effective:
                if not allow_probabilistic_retry:
                    return False
                # 10% probabilistic retry while in cooldown
                if random.random() > self._config.probabilistic_retry_chance:
                    return False
        return True
