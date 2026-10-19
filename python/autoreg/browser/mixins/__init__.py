"""
Browser automation mixins.

Provides reusable components for browser automation:
- AntiDetectionMixin: Anti-fingerprinting and bot detection avoidance
- HumanBehaviorMixin: Human-like typing, clicking, and mouse movements
- CookieHandlingMixin: Cookie banner detection and handling
- NetworkLoggingMixin: Network traffic capture and analysis
- DebuggingMixin: Screenshots, debugging, and error analysis
"""

from .cookie_handling import CookieHandlingMixin
from .debugging import DebuggingMixin
from .network_logging import NetworkLoggingMixin

try:
    from .anti_detection import AntiDetectionMixin
    from .human_behavior import HumanBehaviorMixin
except ImportError:  # open-core: anti-detection mixins are closed modules
    AntiDetectionMixin = None
    HumanBehaviorMixin = None

__all__ = [
    "AntiDetectionMixin",
    "HumanBehaviorMixin",
    "CookieHandlingMixin",
    "NetworkLoggingMixin",
    "DebuggingMixin",
]
