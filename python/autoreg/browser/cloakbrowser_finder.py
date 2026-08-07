"""
CloakBrowser binary discovery — single source of truth.

Replaces three previously-duplicated finders:
- ``BaseBrowser._find_chrome_path`` (soft, with system fallback)
- ``CloakBrowserProfileManager._find_cloakbrowser`` (strict)
- ``FireworksBrowserAutomation._find_cloakbrowser`` (strict)

Provides a single :func:`find_cloakbrowser` with optional strict / auto-download
modes so providers can pick the policy they need without re-implementing
search logic.
"""

from __future__ import annotations

import logging
import os
import platform
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)


def cloakbrowser_binary_name() -> str:
    """Return the platform-specific CloakBrowser binary filename."""
    return "chrome.exe" if platform.system() == "Windows" else "chrome"


def find_cloakbrowser(
    *,
    strict: bool = False,
    auto_download: bool = False,
) -> str | None:
    """Locate the bundled CloakBrowser binary.

    Search order (first hit wins):

    1. ``CLOAKBROWSER_BUNDLED_PATH`` env var (passed by backend).
    2. ``<project_root>/resources/cloakbrowser/<binary>`` (dev layout).
    3. ``<exe_dir>/resources/cloakbrowser/<binary>`` (production, next to Python).
    4. ``<exe_dir>/../resources/cloakbrowser/<binary>`` (PyInstaller layout).
    5. (optional) auto-download to ``<project_root>/resources/cloakbrowser/``.

    Args:
        strict: If True, raise ``RuntimeError`` instead of returning ``None``.
        auto_download: If True and binary not found, attempt to download
            (Windows only, gated by ``AUTOREG_AUTO_DOWNLOAD_CLOAKBROWSER`` env).

    Returns:
        Absolute path to the CloakBrowser binary, or ``None`` if not found
        and ``strict`` is False.

    Raises:
        RuntimeError: If ``strict=True`` and the binary cannot be located.
    """
    binary = cloakbrowser_binary_name()

    env_path = os.environ.get("CLOAKBROWSER_BUNDLED_PATH")
    if env_path and Path(env_path).exists():
        logger.debug("CloakBrowser found via env: %s", env_path)
        return env_path

    project_root = _project_root()
    exe_dir = Path(sys.executable).parent

    candidates = [
        project_root / "resources" / "cloakbrowser" / binary,
        exe_dir / "resources" / "cloakbrowser" / binary,
        exe_dir.parent / "resources" / "cloakbrowser" / binary,
    ]

    for path in candidates:
        if path.exists():
            logger.debug("CloakBrowser found at %s", path)
            return str(path)

    if auto_download:
        downloaded = _attempt_auto_download(project_root)
        if downloaded:
            return downloaded

    if strict:
        raise RuntimeError(
            "CloakBrowser binary not found. "
            "Run: python python/autoreg/browser/download_cloakbrowser.py"
        )

    logger.debug("CloakBrowser binary not found")
    return None


def _project_root() -> Path:
    """Resolve project root from this module's location."""
    # This file lives at python/autoreg/browser/cloakbrowser_finder.py.
    # Four ``parent`` calls walk up to the repository root.
    return Path(__file__).resolve().parent.parent.parent.parent


def _attempt_auto_download(project_root: Path) -> str | None:
    """Try ``download_cloakbrowser.py``. Returns path on success."""
    if os.environ.get("AUTOREG_AUTO_DOWNLOAD_CLOAKBROWSER", "1") != "1":
        return None

    download_script = (
        project_root / "python" / "autoreg" / "browser" / "download_cloakbrowser.py"
    )
    if not download_script.exists():
        return None

    logger.info("CloakBrowser not found — attempting auto-download...")
    try:
        result = subprocess.run(
            [sys.executable, str(download_script)],
            capture_output=True,
            text=True,
            timeout=600,
        )
    except Exception as e:
        logger.warning("Auto-download error: %s", e)
        return None

    binary = cloakbrowser_binary_name()
    downloaded = project_root / "resources" / "cloakbrowser" / binary
    if result.returncode == 0 and downloaded.exists():
        logger.info("CloakBrowser auto-downloaded: %s", downloaded)
        return str(downloaded)

    stderr_preview = (result.stderr or "")[:500]
    logger.warning("Auto-download failed: %s", stderr_preview or "(no error message)")
    return None


__all__ = ["find_cloakbrowser", "cloakbrowser_binary_name"]
