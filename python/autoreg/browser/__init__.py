"""
Browser automation base classes and utilities.
"""

from .async_cloakbrowser_wrapper import AsyncCloakBrowserWrapper
from .base import LAUNCH_CLOAKBROWSER, LAUNCH_DIRECT, BaseBrowser
from .cloakbrowser_profile_manager import CloakBrowserProfileManager
from .profile_launcher import ProfileLauncher

__all__ = [
    "BaseBrowser",
    "LAUNCH_DIRECT",
    "LAUNCH_CLOAKBROWSER",
    "CloakBrowserProfileManager",
    "AsyncCloakBrowserWrapper",
    "ProfileLauncher",
]
