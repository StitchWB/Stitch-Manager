"""
Browser automation mixins.

Provides reusable components for browser automation:
- CookieHandlingMixin: Cookie banner detection and handling
- NetworkLoggingMixin: Network traffic capture and analysis
- DebuggingMixin: Screenshots, debugging, and error analysis
"""

from .cookie_handling import CookieHandlingMixin
from .debugging import DebuggingMixin
from .network_logging import NetworkLoggingMixin

__all__ = [
    "CookieHandlingMixin",
    "NetworkLoggingMixin",
    "DebuggingMixin",
]
