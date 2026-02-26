"""
Browser automation base classes and utilities.
"""

from .base import BaseBrowser

__all__ = ["BaseBrowser"]
from .firefox_profile_manager import FirefoxProfileManager, parse_proxy_url, CamoufoxProxyConfig

__all__ = [
    "FirefoxProfileManager",
    "parse_proxy_url",
    "CamoufoxProxyConfig",
]
