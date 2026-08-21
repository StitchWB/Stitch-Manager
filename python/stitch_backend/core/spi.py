"""Core SPI (Service Provider Interface) registry.

Provides inversion-of-control for core domain services (email verification,
TOTP, mail inbox, OAuth).  Core depends on these Protocol interfaces; built-in
implementations are registered as fallbacks, and service-plugins can override
them by registering with ``source="plugin"``.

Resolution priority: healthy plugin impl > built-in impl.
A plugin impl is "healthy" if it has no ``health_check`` method, or if calling
``health_check()`` returns without raising.  If the health probe raises, the
plugin is treated as dead and the built-in fallback is returned — ``resolve``
never raises for a dead plugin.

This module is dependency-free (no imports from ``domains/`` or the plugin
loader).  Plugin-side registration wiring is added in later todos.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


# ── Exceptions ────────────────────────────────────────────────────────────────


class SpiNotRegistered(KeyError):
    """Raised by ``resolve()`` when no impl (builtin or plugin) is registered
    for the given SPI name.

    Subclasses ``KeyError`` so callers that catch ``KeyError`` for "not found"
    semantics continue to work, while the ``str()`` representation is clear.
    """

    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.name = name

    def __str__(self) -> str:
        return f"SpiNotRegistered: no impl registered for SPI '{self.name}'"


# ── SPI Protocol interfaces ───────────────────────────────────────────────────
#
# These are the contracts core depends on.  Built-in implementations are
# registered by the owning domain at import time; service-plugins override
# them by registering with source="plugin".
#
# Only EmailVerificationProvider has a built-in impl registered today (in
# registration/strategies.py).  TotpProvider, MailInboxSPI, and OAuthProvider
# are declared here as forward-looking contracts — their built-in impls and
# plugin overrides arrive in later todos (14, 15, 20).


@runtime_checkable
class EmailVerificationProvider(Protocol):
    """Email verification code retrieval — used by registration strategies.

    The built-in impl wraps ``domains.email.service.EmailService`` and
    delegates ``wait_otp`` to ``EmailService.wait_for_verification_code``.
    """

    async def wait_otp(
        self,
        email: str,
        subject_filter: str = "",
        code_pattern: str | None = None,
        timeout: float = 120.0,
    ) -> str:
        """Wait for a verification code/OTP for *email* and return it."""
        ...

    async def close(self) -> None:
        """Release IMAP connections and other resources."""
        ...


@runtime_checkable
class TotpProvider(Protocol):
    """TOTP code generation/verification — used by registration MFA steps.

    Built-in impl and plugin override arrive in todo 20.
    """

    async def generate_secret(self) -> str:
        """Generate a new TOTP secret (base32) and return it."""
        ...

    async def get_code(self, secret: str, timestamp: int | None = None) -> str:
        """Generate the current 6-digit TOTP code for *secret*."""
        ...

    async def verify_code(self, secret: str, code: str) -> bool:
        """Verify a TOTP code against *secret* (±1 time step)."""
        ...


@runtime_checkable
class MailInboxSPI(Protocol):
    """Mail inbox profile management and OTP retrieval.

    Used by registration (OTP wait) and the Mail UI page (profile CRUD, sync).
    Built-in impl and plugin override arrive in todos 14/15.
    """

    async def list_profiles(
        self, owner_id: int | None = None,
    ) -> list[dict[str, Any]]:
        """List mail inbox profiles visible to *owner_id*."""
        ...

    async def wait_otp(
        self,
        email: str,
        subject_filter: str = "",
        code_pattern: str | None = None,
        timeout: float = 120.0,
    ) -> str:
        """Wait for a verification code/OTP for *email*."""
        ...

    async def sync(self, profile_id: str) -> dict[str, Any]:
        """Run a sync tick for *profile_id* and return the new sync state."""
        ...


@runtime_checkable
class OAuthProvider(Protocol):
    """OAuth 2.0 flow orchestration — PKCE + Device Authorization Grant.

    The built-in impl wraps ``domains.oauth.pkce.PKCEFlow`` and
    ``domains.oauth.device_flow.DeviceFlow``.  Plugin override arrives in
    later todos (needed by the sheets plugin and any Google/MS integration).
    """

    async def start_pkce_flow(
        self,
        authorize_url: str,
        token_url: str,
        client_id: str,
        redirect_uri: str = "http://localhost:25584/api/oauth/callback",
        scope: str = "openid profile email",
        state: str | None = None,
    ) -> dict[str, Any]:
        """Start a PKCE flow — returns ``{authorizationUrl, codeVerifier}``."""
        ...

    async def start_device_flow(
        self,
        device_auth_url: str,
        token_url: str,
        client_id: str,
        scope: str = "",
    ) -> dict[str, Any]:
        """Start a device flow — returns ``{userCode, verificationUri, ...}``."""
        ...

    async def exchange_code(
        self,
        code: str,
        code_verifier: str,
        token_url: str,
        client_id: str,
        redirect_uri: str = "http://localhost:25584/api/oauth/callback",
        proxy: str | None = None,
    ) -> dict[str, Any]:
        """Exchange an authorization code for tokens."""
        ...


# ── SPI name constants ───────────────────────────────────────────────────────
#
# Use these instead of raw strings to avoid typos.

SPI_EMAIL_VERIFICATION = "email_verification"
SPI_TOTP = "totp"
SPI_MAIL_INBOX = "mail_inbox"
SPI_OAUTH = "oauth"


# ── Registry ─────────────────────────────────────────────────────────────────


class _SpiRegistry:
    """Thread-safe registry of SPI implementations.

    Each SPI name maps to two slots: ``builtin`` and ``plugin``.  ``resolve``
    returns the plugin impl when it is registered and healthy, otherwise the
    built-in impl.  If neither exists, raises :class:`SpiNotRegistered`.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        # name -> {"builtin": impl | None, "plugin": impl | None}
        self._impls: dict[str, dict[str, Any]] = {}

    def register_impl(
        self,
        name: str,
        impl: Any,
        source: str = "builtin",
    ) -> None:
        """Register *impl* under *name* with the given source.

        ``source`` must be ``"builtin"`` or ``"plugin"``.  Re-registering
        overwrites the previous impl for that source slot.
        """
        if source not in ("builtin", "plugin"):
            raise ValueError(
                f"source must be 'builtin' or 'plugin', got {source!r}"
            )
        with self._lock:
            slots = self._impls.setdefault(
                name, {"builtin": None, "plugin": None}
            )
            slots[source] = impl
            logger.debug("SPI %s: registered %s impl %r", name, source, impl)

    def unregister_plugin(self, name: str) -> bool:
        """Remove the plugin impl for *name* (built-in stays).

        Returns ``True`` if a plugin impl was removed, ``False`` if none was
        registered.
        """
        with self._lock:
            slots = self._impls.get(name)
            if not slots or slots.get("plugin") is None:
                return False
            slots["plugin"] = None
            logger.debug("SPI %s: unregistered plugin impl", name)
            return True

    def resolve(self, name: str) -> Any:
        """Return the healthy plugin impl, or the built-in impl.

        Priority: healthy plugin > built-in.  A plugin impl is healthy if it
        has no ``health_check`` method, or if calling ``health_check()``
        returns without raising.  If the health probe raises, the plugin is
        treated as dead and the built-in fallback is returned — ``resolve``
        never raises for a dead plugin.

        Raises :class:`SpiNotRegistered` if no impl (builtin or plugin) is
        registered for *name*.
        """
        with self._lock:
            slots = self._impls.get(name)
            if not slots:
                raise SpiNotRegistered(name)
            plugin_impl = slots.get("plugin")
            builtin_impl = slots.get("builtin")

            if plugin_impl is not None and self._is_healthy(plugin_impl):
                return plugin_impl

            if plugin_impl is not None:
                # Plugin exists but is unhealthy — log and fall back.
                logger.warning(
                    "SPI %s: plugin impl failed health probe — "
                    "falling back to built-in",
                    name,
                )

            if builtin_impl is not None:
                return builtin_impl

            raise SpiNotRegistered(name)

    def list_spi(self) -> dict[str, dict[str, Any]]:
        """Return a snapshot of all registered SPIs.

        Each entry: ``{name: {"builtin": bool, "plugin": bool, "healthy": bool}}``.
        """
        with self._lock:
            result: dict[str, dict[str, Any]] = {}
            for name, slots in self._impls.items():
                plugin_impl = slots.get("plugin")
                result[name] = {
                    "builtin": slots.get("builtin") is not None,
                    "plugin": plugin_impl is not None,
                    "healthy": (
                        self._is_healthy(plugin_impl)
                        if plugin_impl is not None
                        else False
                    ),
                }
            return result

    @staticmethod
    def _is_healthy(impl: Any) -> bool:
        """Return ``True`` if *impl* has no ``health_check`` method, or if
        calling ``health_check()`` returns without raising.
        """
        probe = getattr(impl, "health_check", None)
        if probe is None:
            return True
        try:
            probe()
            return True
        except Exception:
            return False


# Singleton registry
spi_registry = _SpiRegistry()


# ── Module-level convenience functions ────────────────────────────────────────


def register_impl(name: str, impl: Any, source: str = "builtin") -> None:
    """Module-level shortcut for ``spi_registry.register_impl()``."""
    spi_registry.register_impl(name, impl, source=source)


def resolve(name: str) -> Any:
    """Module-level shortcut for ``spi_registry.resolve()``."""
    return spi_registry.resolve(name)


def unregister_plugin(name: str) -> bool:
    """Module-level shortcut for ``spi_registry.unregister_plugin()``."""
    return spi_registry.unregister_plugin(name)


def list_spi() -> dict[str, dict[str, Any]]:
    """Module-level shortcut for ``spi_registry.list_spi()``."""
    return spi_registry.list_spi()
