"""
Browser automation base classes and utilities.
"""

from .base import LAUNCH_CLOAKBROWSER, LAUNCH_DIRECT, BaseBrowser
from .playwright_cdp_attachment import PlaywrightCdpAttachment
from .profile_launcher import ProfileLauncher

try:
    from .cloakbrowser_profile_manager import CloakBrowserProfileManager
except ImportError:  # open-core: CloakBrowser kit is a closed module
    CloakBrowserProfileManager = None

__all__ = [
    "BaseBrowser",
    "LAUNCH_DIRECT",
    "LAUNCH_CLOAKBROWSER",
    "CloakBrowserProfileManager",
    "PlaywrightCdpAttachment",
    "ProfileLauncher",
]
