"""
iCloud Hide My Email service.

Wraps pyicloud to manage Apple ID sessions and generate Hide My Email aliases.
Handles 2FA challenge, session persistence (cookie jar on disk), and rate limits.

Apple's limit: ~5 aliases per 30 minutes per account.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Rate limit tracker ────────────────────────────────────────────────────────

_RATE_WINDOW_SECONDS = 30 * 60   # 30 minutes
_RATE_LIMIT_COUNT    = 5          # aliases per window


@dataclass
class _RateWindow:
    timestamps: list[float] = field(default_factory=list)

    def record(self) -> None:
        now = time.time()
        self.timestamps.append(now)
        # Prune old entries
        cutoff = now - _RATE_WINDOW_SECONDS
        self.timestamps = [t for t in self.timestamps if t >= cutoff]

    def remaining(self) -> int:
        now = time.time()
        cutoff = now - _RATE_WINDOW_SECONDS
        recent = [t for t in self.timestamps if t >= cutoff]
        return max(0, _RATE_LIMIT_COUNT - len(recent))

    def seconds_until_slot(self) -> float:
        """Return 0 if a slot is available, else seconds until oldest entry expires."""
        if self.remaining() > 0:
            return 0.0
        now = time.time()
        cutoff = now - _RATE_WINDOW_SECONDS
        recent = sorted(t for t in self.timestamps if t >= cutoff)
        if not recent:
            return 0.0
        return max(0.0, recent[0] + _RATE_WINDOW_SECONDS - now)


# ── Config ────────────────────────────────────────────────────────────────────

@dataclass
class ICloudConfig:
    """Credentials and options for the iCloud service."""

    apple_id: str
    """Apple ID (email address, e.g. user@icloud.com)."""

    app_specific_password: str
    """App-specific password generated at appleid.apple.com."""

    cookie_directory: str = ""
    """Directory to persist pyicloud session cookies. Defaults to ~/.pyicloud."""

    verify_imap: bool = True
    """Whether to verify incoming mail via iCloud IMAP after alias creation."""

    imap_password: str = ""
    """iCloud IMAP password (= app-specific password, same as app_specific_password)."""


# ── Service ───────────────────────────────────────────────────────────────────

class ICloudService:
    """
    Thin wrapper around pyicloud for iCloud Hide My Email operations.

    Usage::

        cfg = ICloudConfig(apple_id="you@icloud.com", app_specific_password="xxxx-xxxx")
        svc = ICloudService(cfg)
        svc.authenticate()           # raises TwoFactorRequired if needed
        alias = svc.generate_alias("Kiro registration")
        print(alias["email"])        # e.g. abc123@privaterelay.appleid.com
        svc.delete_alias(alias["id"])
    """

    def __init__(self, config: ICloudConfig) -> None:
        self._cfg = config
        self._api: Any = None          # pyicloud.PyiCloudService instance
        self._rate = _RateWindow()

    # ── Auth ──────────────────────────────────────────────────────────────────

    def authenticate(self, verification_code: str | None = None) -> None:
        """
        Authenticate with Apple ID.

        On first call this establishes a session. If 2FA is required,
        raises ``TwoFactorRequired``; call again with ``verification_code``
        to complete the flow.

        Args:
            verification_code: 6-digit 2FA code from trusted device.

        Raises:
            TwoFactorRequired: Apple requires 2FA confirmation.
            ICloudAuthError: Credentials are invalid.
        """
        try:
            from pyicloud import PyiCloudService
            from pyicloud.exceptions import (
                PyiCloudFailedLoginException,
                PyiCloudNoStoredPasswordAvailableException,
            )
        except ImportError as exc:
            raise RuntimeError(
                "pyicloud is not installed. Run: pip install pyicloud>=1.0.0"
            ) from exc

        cookie_dir = self._cfg.cookie_directory or None

        logger.info("Authenticating iCloud for %s", self._cfg.apple_id)

        try:
            self._api = PyiCloudService(
                apple_id=self._cfg.apple_id,
                password=self._cfg.app_specific_password,
                cookie_directory=cookie_dir,
            )
        except PyiCloudFailedLoginException as exc:
            raise ICloudAuthError(f"Invalid Apple ID credentials: {exc}") from exc
        except PyiCloudNoStoredPasswordAvailableException as exc:
            raise ICloudAuthError(f"No stored password: {exc}") from exc

        if self._api.requires_2fa:
            if verification_code is None:
                raise TwoFactorRequired(
                    "iCloud account requires 2FA. "
                    "Call authenticate(verification_code='XXXXXX') with the code "
                    "sent to your trusted device."
                )
            result = self._api.validate_2fa_code(verification_code)
            if not result:
                raise ICloudAuthError("Invalid 2FA code.")
            logger.info("2FA validated for %s", self._cfg.apple_id)

        elif self._api.requires_2sa:
            if verification_code is None:
                devices = self._api.trusted_devices
                raise TwoFactorRequired(
                    f"iCloud account requires 2-step verification. "
                    f"Trusted devices: {devices}. "
                    f"Call authenticate(verification_code='XXXXXX')."
                )
            device = self._api.trusted_devices[0]
            self._api.send_verification_code(device)
            result = self._api.validate_verification_code(device, verification_code)
            if not result:
                raise ICloudAuthError("Invalid 2-step verification code.")

        logger.info("iCloud authenticated for %s", self._cfg.apple_id)

    def is_authenticated(self) -> bool:
        """Return True if the session is active."""
        return self._api is not None and not getattr(self._api, "requires_2fa", False)

    # ── Hide My Email ─────────────────────────────────────────────────────────

    def generate_alias(self, label: str = "Auto-registration") -> dict[str, str]:
        """
        Generate a new Hide My Email alias.

        Respects the Apple rate limit (~5 per 30 min). Raises ``RateLimitError``
        if the window is exhausted.

        Args:
            label: Human-readable label for the alias (shown in iCloud settings).

        Returns:
            Dict with keys: ``email``, ``id``, ``label``, ``created_at``.

        Raises:
            RateLimitError: Rate window exhausted; check ``seconds_until_slot()``.
            ICloudNotAuthenticatedError: Session not established.
            ICloudServiceError: Apple API returned an error.
        """
        self._ensure_authenticated()

        if self._rate.remaining() == 0:
            wait = self._rate.seconds_until_slot()
            raise RateLimitError(
                f"Apple Hide My Email rate limit reached. "
                f"Try again in {wait:.0f} seconds (~{wait/60:.1f} min).",
                retry_after=wait,
            )

        logger.info("Creating iCloud Hide My Email alias: label=%r", label)

        try:
            hme = self._api.hide_my_email
            alias_data = hme.generate()   # returns dict with 'hme' key
        except AttributeError as exc:
            raise ICloudServiceError(
                "pyicloud does not expose hide_my_email. "
                "Ensure pyicloud>=1.0.0 is installed."
            ) from exc
        except Exception as exc:
            raise ICloudServiceError(f"Failed to generate alias: {exc}") from exc

        # pyicloud returns something like:
        # {"hme": "abc123@privaterelay.appleid.com", "anonymousId": "uuid", ...}
        email = alias_data.get("hme") or alias_data.get("email", "")
        alias_id = alias_data.get("anonymousId") or alias_data.get("id", "")

        if not email:
            raise ICloudServiceError(
                f"Unexpected alias response from Apple API: {alias_data}"
            )

        # Set the label on the alias
        try:
            hme.update_label(alias_id, label)
        except Exception:
            logger.warning("Could not set label for alias %s", alias_id)

        self._rate.record()

        result = {
            "email": email,
            "id": alias_id,
            "label": label,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        logger.info("Created Hide My Email alias: %s", email)
        return result

    def delete_alias(self, alias_id: str) -> None:
        """
        Delete a Hide My Email alias by its anonymous ID.

        Args:
            alias_id: The ``anonymousId`` returned by ``generate_alias()``.

        Raises:
            ICloudServiceError: Deletion failed.
        """
        self._ensure_authenticated()

        logger.info("Deleting iCloud alias: %s", alias_id)
        try:
            self._api.hide_my_email.deactivate(alias_id)
            logger.info("Deleted alias: %s", alias_id)
        except Exception as exc:
            raise ICloudServiceError(f"Failed to delete alias {alias_id}: {exc}") from exc

    def list_aliases(self) -> list[dict[str, Any]]:
        """
        List all active Hide My Email aliases for this account.

        Returns:
            List of dicts with keys: ``email``, ``id``, ``label``, ``isActive``.
        """
        self._ensure_authenticated()

        try:
            raw = self._api.hide_my_email.get_all_emails()
        except Exception as exc:
            raise ICloudServiceError(f"Failed to list aliases: {exc}") from exc

        results = []
        for item in raw:
            results.append({
                "email": item.get("hme") or item.get("forwardToEmail", ""),
                "id": item.get("anonymousId", ""),
                "label": item.get("label", ""),
                "isActive": item.get("isActive", True),
            })
        return results

    # ── Rate info ─────────────────────────────────────────────────────────────

    def rate_remaining(self) -> int:
        """Return how many aliases can be created before hitting Apple's rate limit."""
        return self._rate.remaining()

    def rate_seconds_until_slot(self) -> float:
        """Return seconds until the next slot is available (0 if available now)."""
        return self._rate.seconds_until_slot()

    # ── Internals ─────────────────────────────────────────────────────────────

    def _ensure_authenticated(self) -> None:
        if not self.is_authenticated():
            raise ICloudNotAuthenticatedError(
                "Not authenticated. Call ICloudService.authenticate() first."
            )

    def close(self) -> None:
        """Release session resources."""
        self._api = None


# ── Exceptions ────────────────────────────────────────────────────────────────

class ICloudError(Exception):
    """Base class for iCloud service errors."""


class ICloudAuthError(ICloudError):
    """Authentication failed (bad credentials or 2FA code)."""


class TwoFactorRequired(ICloudError):
    """Apple requires 2FA/2SA to continue. Caller must supply a code."""


class ICloudNotAuthenticatedError(ICloudError):
    """Operation attempted before authenticate() was called."""


class ICloudServiceError(ICloudError):
    """Apple API returned an unexpected error."""


class RateLimitError(ICloudError):
    """Apple's Hide My Email rate limit has been reached."""

    def __init__(self, message: str, retry_after: float = 0.0) -> None:
        super().__init__(message)
        self.retry_after = retry_after


__all__ = [
    "ICloudConfig",
    "ICloudService",
    "ICloudError",
    "ICloudAuthError",
    "TwoFactorRequired",
    "ICloudNotAuthenticatedError",
    "ICloudServiceError",
    "RateLimitError",
]
