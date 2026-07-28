"""Domain exception hierarchy.

All Stitch-specific exceptions inherit from :class:`StitchError` so that
API middleware can catch them uniformly and return proper HTTP responses.
"""

from __future__ import annotations


class StitchError(Exception):
    """Base exception for all Stitch domain errors."""

    def __init__(self, message: str = "", *, detail: str | None = None) -> None:
        self.detail = detail or message
        super().__init__(message)


# ── Account errors ────────────────────────────────────────────────────────────

class AccountNotFoundError(StitchError):
    def __init__(self, account_id: str | int) -> None:
        super().__init__(f"Account not found: {account_id}")
        self.account_id = account_id


class AccountAlreadyExistsError(StitchError):
    def __init__(self, email: str, provider: str) -> None:
        super().__init__(f"Account already exists: {email} ({provider})")
        self.email = email
        self.provider = provider


# ── Registration errors ───────────────────────────────────────────────────────

class RegistrationError(StitchError):
    """Generic registration failure."""


class CaptchaError(RegistrationError):
    """Captcha solving failed."""


class EmailVerificationError(RegistrationError):
    """Verification code not received within timeout."""


class TokenExtractionError(RegistrationError):
    """Could not extract tokens from browser session."""


# ── Provider errors ───────────────────────────────────────────────────────────

class ProviderError(StitchError):
    """Generic provider plugin error."""


class ProviderNotAvailableError(ProviderError):
    """Provider is registered but not currently usable (e.g. maintenance)."""


# ── Job errors ────────────────────────────────────────────────────────────────

class JobError(StitchError):
    """Job manager / job execution error."""


class JobCancelledError(JobError):
    """Job was cancelled by the user."""


class JobNotFoundError(JobError):
    def __init__(self, job_id: str) -> None:
        super().__init__(f"Job not found: {job_id}")
        self.job_id = job_id


# ── Profile errors ────────────────────────────────────────────────────────────

class ProfileError(StitchError):
    """Generic profile-related error."""


class ProfileNotFoundError(ProfileError):
    def __init__(self, alias: str) -> None:
        super().__init__(f"Profile not found: {alias}")
        self.alias = alias


class ProfileAliasExistsError(ProfileError):
    def __init__(self, alias: str) -> None:
        super().__init__(f"Alias already exists: {alias}")
        self.alias = alias
