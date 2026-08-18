"""
Browser automation base classes and utilities.
"""

from .base import LAUNCH_CLOAKBROWSER, LAUNCH_DIRECT, BaseBrowser
from .cloakbrowser_profile_manager import CloakBrowserProfileManager
from .playwright_cdp_attachment import PlaywrightCdpAttachment
from .profile_launcher import ProfileLauncher

__all__ = [
    "BaseBrowser",
    "LAUNCH_DIRECT",
    "LAUNCH_CLOAKBROWSER",
    "CloakBrowserProfileManager",
    "PlaywrightCdpAttachment",
    "ProfileLauncher",
]
