"""Browser automation surface of the provider SDK (ADR-005).

Re-exports the Zone-1 browser building blocks a provider is allowed to use.
"""

from autoreg.browser.base import BaseBrowser
from autoreg.browser.mixins import (
    CookieHandlingMixin,
    DebuggingMixin,
    NetworkLoggingMixin,
)

__all__ = [
    "BaseBrowser",
    "CookieHandlingMixin",
    "NetworkLoggingMixin",
    "DebuggingMixin",
]
