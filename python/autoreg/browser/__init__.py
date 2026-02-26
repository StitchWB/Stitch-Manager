"""
Browser automation base classes and utilities.
"""

from .base import BaseBrowser
from .firefox_profile_manager import FirefoxProfileManager, parse_proxy_url, CamoufoxProxyConfig
from .profile_launcher import ProfileLauncher

__all__ = [
    "BaseBrowser",
    "FirefoxProfileManager",
    "parse_proxy_url",
    "CamoufoxProxyConfig",
    "ProfileLauncher",
]
