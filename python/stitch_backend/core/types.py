"""Shared type definitions used across domains.

Centralising types here prevents circular imports between domain packages
and keeps Protocol contracts in one place.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Protocol, runtime_checkable

# ── Account status ────────────────────────────────────────────────────────────

class AccountStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"
    EXPIRED = "expired"
    BANNED = "banned"
    PENDING = "pending"

    def __str__(self) -> str:
        return self.value


# ── Job status ────────────────────────────────────────────────────────────────

class JobStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"

    def __str__(self) -> str:
        return self.value


# ── Token data ────────────────────────────────────────────────────────────────

@dataclass
class TokenData:
    """Bundle of credentials extracted from a browser session."""

    access_token: str | None = None
    refresh_token: str | None = None
    expires_at: datetime | None = None
    token_type: str = "bearer"
    api_key: str | None = None
    session_id: str | None = None
    device_id: str | None = None
    cookies: dict[str, str] = field(default_factory=dict)
    local_storage: dict[str, str] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


# ── Registration context ──────────────────────────────────────────────────────

@dataclass
class RegContext:
    """Mutable bag of state passed through the registration pipeline."""

    provider_id: str
    email: str = ""
    password: str = ""
    display_name: str = ""
    proxy: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))


# ── Browser profile ──────────────────────────────────────────────────────────

@dataclass
class BrowserProfile:
    """Fingerprint + environment for a browser session."""

    profile_path: str = ""
    user_agent: str = ""
    fingerprint: dict[str, Any] = field(default_factory=dict)
    proxy: str | None = None
    headless: bool = False


# ── Strategy Protocols ────────────────────────────────────────────────────────
# These are the composition "slots" that providers fill in.
# Using ``runtime_checkable`` Protocols means we get ``isinstance`` checks for
# free without forcing providers into an inheritance tree.

@runtime_checkable
class EmailStrategy(Protocol):
    """Acquire an email address for registration."""

    async def acquire_email(self, ctx: RegContext) -> str: ...
    async def cleanup(self, email: str) -> None: ...


@runtime_checkable
class BrowserStrategy(Protocol):
    """Launch and tear down a browser session."""

    async def launch(self, profile: BrowserProfile) -> Any: ...   # returns BrowserSession
    async def close(self, session: Any) -> None: ...


@runtime_checkable
class CaptchaStrategy(Protocol):
    """Solve a CAPTCHA challenge."""

    async def solve(self, session: Any, site_key: str) -> str: ...


@runtime_checkable
class EmailVerificationStrategy(Protocol):
    """Wait for a verification code to arrive in the inbox."""

    async def wait_for_code(self, email: str, timeout: float = 120) -> str: ...


@runtime_checkable
class TokenExtractorProtocol(Protocol):
    """Extract credentials from a browser session."""

    async def extract(self, session: Any) -> TokenData: ...


@runtime_checkable
class StorageStrategy(Protocol):
    """Persist credentials to the database / keyring."""

    async def store(self, account_id: str, tokens: TokenData) -> None: ...
