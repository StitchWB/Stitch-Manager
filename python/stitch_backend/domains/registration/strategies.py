"""Concrete registration strategies implementing the Protocol contracts.

These are the building blocks that provider plugins compose together.
Each strategy handles one aspect of the registration flow.
"""

from __future__ import annotations

import logging
import random
import string
from typing import Any

from stitch_backend.core.types import TokenData

logger = logging.getLogger(__name__)


# ── Password generator ──────────────────────────────────────────────────────

def generate_password(length: int = 16) -> str:
    """Generate a strong random password."""
    chars = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(random.choices(chars, k=length))


# ── Captcha strategies ──────────────────────────────────────────────────────

class TurnstileStrategy:
    """Solve Cloudflare Turnstile captchas via an external API."""

    def __init__(self, api_key_setting: str = "captcha_api_key") -> None:
        self._api_key_setting = api_key_setting

    async def solve(self, session: Any, site_key: str) -> str:
        """Solve a Turnstile challenge.

        In production this calls a captcha-solving service (e.g. 2captcha).
        Currently returns a placeholder token.
        """
        from stitch_backend.config import get_settings
        settings = get_settings()
        api_key = getattr(settings, self._api_key_setting, None)
        if not api_key:
            logger.warning("No captcha API key configured — returning stub token")
            return "stub-turnstile-token"

        # TODO: Real Turnstile solving via httpx POST to captcha service
        logger.info("TurnstileStrategy: solving site_key=%s (stub)", site_key)
        return f"turnstile-solved-{site_key[:8]}"


class HCaptchaStrategy:
    """Solve hCaptcha challenges via an external API."""

    def __init__(self, api_key_setting: str = "captcha_api_key") -> None:
        self._api_key_setting = api_key_setting

    async def solve(self, session: Any, site_key: str) -> str:
        logger.info("HCaptchaStrategy: solving site_key=%s (stub)", site_key)
        return f"hcaptcha-solved-{site_key[:8]}"


# ── Email verification strategies ───────────────────────────────────────────

class ImapVerificationStrategy:
    """Wait for a verification code via IMAP inbox polling."""

    def __init__(
        self,
        subject_filter: str = "",
        code_pattern: str | None = None,
        timeout: float = 120.0,
    ) -> None:
        self._subject_filter = subject_filter
        self._code_pattern = code_pattern
        self._timeout = timeout

    async def wait_for_code(self, email: str, timeout: float | None = None) -> str:
        from stitch_backend.domains.email.service import EmailService
        svc = EmailService()
        try:
            return await svc.wait_for_verification_code(
                email=email,
                subject_filter=self._subject_filter,
                code_pattern=self._code_pattern,
                timeout=timeout or self._timeout,
            )
        finally:
            await svc.close()


# ── Token extractors ────────────────────────────────────────────────────────

class CookieTokenExtractor:
    """Extract tokens from browser cookies."""

    def __init__(
        self,
        cookie_names: list[str] | None = None,
        storage_keys: list[str] | None = None,
    ) -> None:
        self._cookie_names = cookie_names or []
        self._storage_keys = storage_keys or []

    async def extract(self, session: Any) -> TokenData:
        """Extract token data from a browser session.

        In production this reads cookies/localStorage from the DrissionPage
        session.  Currently returns a stub TokenData.
        """
        cookies = {}
        if hasattr(session, "get_cookies"):
            raw_cookies = await session.get_cookies()
            for name in self._cookie_names:
                if name in raw_cookies:
                    cookies[name] = raw_cookies[name]

        # Stub: return a placeholder token
        token = cookies.get(self._cookie_names[0], "stub-token") if self._cookie_names else "stub-token"
        return TokenData(
            access_token=token,
            cookies=cookies,
        )


class LocalStorageTokenExtractor:
    """Extract tokens from browser localStorage."""

    def __init__(self, keys: list[str] | None = None) -> None:
        self._keys = keys or []

    async def extract(self, session: Any) -> TokenData:
        local_storage = {}
        if hasattr(session, "get_local_storage"):
            raw = await session.get_local_storage()
            for key in self._keys:
                if key in raw:
                    local_storage[key] = raw[key]

        token = local_storage.get(self._keys[0], "stub-token") if self._keys else "stub-token"
        return TokenData(
            access_token=token,
            local_storage=local_storage,
        )


# ── Browser strategy ────────────────────────────────────────────────────────

class DrissionPageBrowser:
    """Launch and manage a DrissionPage browser session."""

    def __init__(self, headless: bool = False) -> None:
        self._headless = headless

    async def launch(self, profile: Any) -> Any:
        """Launch a browser session.

        In production this creates a DrissionPage ChromiumPage.
        Currently returns a stub session object.
        """
        logger.info(
            "DrissionPageBrowser: launch (headless=%s, profile=%s) — stub",
            self._headless,
            getattr(profile, "profile_path", "default"),
        )

        # Stub session object
        class StubSession:
            async def get_cookies(self):
                return {}

            async def get_local_storage(self):
                return {}

        return StubSession()

    async def close(self, session: Any) -> None:
        logger.info("DrissionPageBrowser: close (stub)")
