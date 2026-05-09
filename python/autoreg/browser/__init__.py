"""
Browser automation base classes and utilities.
"""

from .base import BaseBrowser
from .cloakbrowser_profile_manager import CloakBrowserProfileManager
from .async_cloakbrowser_wrapper import AsyncCloakBrowserWrapper
from .firefox_profile_manager import FirefoxProfileManager, parse_proxy_url, CamoufoxProxyConfig
from .profile_launcher import ProfileLauncher

__all__ = [
    "BaseBrowser",
    "CloakBrowserProfileManager",
    "AsyncCloakBrowserWrapper",
    "FirefoxProfileManager",
    "parse_proxy_url",
    "CamoufoxProxyConfig",
    "ProfileLauncher",
]
