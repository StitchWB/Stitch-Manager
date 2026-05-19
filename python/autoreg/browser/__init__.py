"""
Browser automation base classes and utilities.
"""

from .base import BaseBrowser, LAUNCH_DIRECT, LAUNCH_CLOAKBROWSER
from .cloakbrowser_profile_manager import CloakBrowserProfileManager
from .async_cloakbrowser_wrapper import AsyncCloakBrowserWrapper
from .profile_launcher import ProfileLauncher

__all__ = [
    "BaseBrowser",
    "LAUNCH_DIRECT",
    "LAUNCH_CLOAKBROWSER",
    "CloakBrowserProfileManager",
    "AsyncCloakBrowserWrapper",
    "ProfileLauncher",
]
