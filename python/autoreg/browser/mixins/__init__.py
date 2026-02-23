"""
Browser automation mixins.

Provides reusable components for browser automation:
- AntiDetectionMixin: Anti-fingerprinting and bot detection avoidance
- HumanBehaviorMixin: Human-like typing, clicking, and mouse movements
- CookieHandlingMixin: Cookie banner detection and handling
- NetworkLoggingMixin: Network traffic capture and analysis
- DebuggingMixin: Screenshots, debugging, and error analysis
"""

from .anti_detection import AntiDetectionMixin
from .cookie_handling import CookieHandlingMixin
from .debugging import DebuggingMixin
from .human_behavior import HumanBehaviorMixin
from .network_logging import NetworkLoggingMixin

__all__ = [
    "AntiDetectionMixin",
    "HumanBehaviorMixin",
    "CookieHandlingMixin",
    "NetworkLoggingMixin",
    "DebuggingMixin",
]
