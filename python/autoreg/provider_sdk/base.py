"""Base Provider - Abstract interface for AI IDE providers.

Canonical location: ``autoreg.provider_sdk`` (ADR-005).  Imported by
providers through the SDK facade only; ``autoreg.providers.base`` is a
backwards-compat shim.
"""

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from autoreg.provider_ids import ProviderId


@dataclass
class ProviderConfig:
    """Provider configuration.

    ``id`` is the legacy ``ProviderId`` enum for built-ins, a plain string
    for packages added after ADR-005 §3 (no hub enum edit needed).
    """
    id: ProviderId | str
    name: str
    auth_url: str
    token_path: str
    uses_pkce: bool = False
    uses_firebase: bool = False
    api_key: str | None = None
    client_id: str | None = None


class BaseProvider(ABC):
    """Abstract base class for providers"""

    def __init__(self, headless: bool = False):
        self.headless = headless
        self.log_callback: Callable[[str], None] | None = None

    @property
    @abstractmethod
    def config(self) -> ProviderConfig:
        """Get provider configuration"""
        pass

    @property
    def id(self) -> ProviderId | str:
        return self.config.id

    @property
    def name(self) -> str:
        return self.config.name

    def log(self, message: str):
        """Log message with provider prefix"""
        raw_id = self.config.id
        provider_name = (
            raw_id.value if isinstance(raw_id, ProviderId) else raw_id
        ).upper()  # "KIRO", "WINDSURF", etc.
        prefixed_message = f"[{provider_name}] {message}"

        print(prefixed_message, flush=True)
        if self.log_callback:
            self.log_callback(prefixed_message)

    @abstractmethod
    def register(
        self,
        email: str,
        password: str,
        name: str | None = None,
        **kwargs
    ) -> dict[str, Any]:
        """
        Register a new account.

        Returns:
            Dict with 'success', 'email', 'token_data', 'error'
        """
        pass

    @abstractmethod
    def close(self):
        """Cleanup resources"""
        pass
