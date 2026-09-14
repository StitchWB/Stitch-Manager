"""Browser automation surface of the provider SDK (ADR-005).

Re-exports the Zone-1 browser building blocks a provider is allowed to use.
"""

from autoreg.browser.base import BaseBrowser
from autoreg.browser.mixins import (
    AntiDetectionMixin,
    CookieHandlingMixin,
    DebuggingMixin,
    HumanBehaviorMixin,
    NetworkLoggingMixin,
)

__all__ = [
    "BaseBrowser",
    "AntiDetectionMixin",
    "HumanBehaviorMixin",
    "CookieHandlingMixin",
    "NetworkLoggingMixin",
    "DebuggingMixin",
]
