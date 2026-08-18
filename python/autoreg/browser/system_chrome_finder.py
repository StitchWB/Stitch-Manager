"""
System Chrome / Chromium executable discovery.

Used as a fallback when CloakBrowser is unavailable and a provider has opted
into a soft search mode. Searches Windows Registry, common installation
directories, and platform-specific defaults.
"""

from __future__ import annotations

import logging
import os
import platform
from collections.abc import Iterable

logger = logging.getLogger(__name__)


def find_system_chrome() -> str | None:
    """Locate Chrome / Chromium / Edge on the host system.

    Returns:
        Absolute path to a Chromium-compatible browser executable, or ``None``
        if nothing was found.
    """
    system = platform.system()
    if system == "Windows":
        return _find_chrome_windows()
    if system == "Darwin":
        return _find_chrome_macos()
    return _find_chrome_linux()


def _find_chrome_windows() -> str | None:
    try:
        import winreg

        registry_keys = [
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
            (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
        ]
        for root, key_path in registry_keys:
            try:
                with winreg.OpenKey(root, key_path) as key:
                    chrome_path, _ = winreg.QueryValueEx(key, "")
                    if os.path.exists(chrome_path):
                        logger.debug("Chrome from registry: %s", chrome_path)
                        return str(chrome_path)
            except FileNotFoundError:
                continue
    except ImportError:
        logger.warning("winreg not available — falling back to filesystem search")

    return _first_existing(
        [
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles%\Chromium\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Chromium\Application\chrome.exe"),
            os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        ]
    )


def _find_chrome_macos() -> str | None:
    return _first_existing(
        [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ]
    )


def _find_chrome_linux() -> str | None:
    return _first_existing(
        [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
        ]
    )


def _first_existing(paths: Iterable[str]) -> str | None:
    for path in paths:
        if path and os.path.exists(path):
            logger.debug("Chrome at: %s", path)
            return path
    return None


__all__ = ["find_system_chrome"]
