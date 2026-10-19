"""
Chrome subprocess utilities — process killing, lock cleanup, PID capture.

Centralizes logic that was previously duplicated in
``CloakBrowserProfileManager`` and ``FireworksBrowserAutomation``.
"""

from __future__ import annotations

import logging
import os
import shutil
import time
from pathlib import Path

logger = logging.getLogger(__name__)

PathLike = str | Path


def kill_chrome_for_profile(
    profile_dir: PathLike,
    *,
    settle_seconds: float = 0.5,
) -> int:
    """Kill Chrome processes whose cmdline references the given profile dir.

    Safe to call without ``psutil`` (logs a warning, returns 0). Matches
    case-insensitively against absolute path.

    Args:
        profile_dir: Profile directory to match against process command lines.
        settle_seconds: Sleep after killing to let the OS release file handles.

    Returns:
        Number of processes killed.
    """
    try:
        import psutil
    except ImportError:
        logger.warning("psutil not available — cannot kill stale Chrome processes")
        return 0

    profile_abs = os.path.abspath(str(profile_dir)).lower()
    killed = 0

    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            cmdline = proc.info.get("cmdline") or []
            if not any("chrome" in (arg or "").lower() for arg in cmdline):
                continue
            if any(profile_abs in (arg or "").lower() for arg in cmdline):
                proc.kill()
                killed += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    if killed:
        logger.info("Killed %d Chrome processes for profile %s", killed, profile_dir)
        time.sleep(settle_seconds)

    return killed


def capture_chrome_pids_for_profile(profile_dir: PathLike) -> list[int]:
    """Return PIDs of Chrome processes using the given profile directory.

    Used to track *our* Chrome instance so later cleanup can target only
    those PIDs without affecting the user's personal browser.

    Args:
        profile_dir: Profile directory to match.

    Returns:
        List of PIDs (empty if psutil missing or no matches).
    """
    try:
        import psutil
    except ImportError:
        return []

    profile_str = str(profile_dir)
    pids: list[int] = []

    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            name = (proc.info.get("name") or "").lower()
            if "chrome" not in name and "msedge" not in name:
                continue
            cmdline = proc.info.get("cmdline") or []
            if any(profile_str in (arg or "") for arg in cmdline):
                pids.append(proc.info["pid"])
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    return pids


def cleanup_chrome_lock_files(profile_dir: PathLike) -> int:
    """Remove stale Chrome singleton lock files.

    Chrome refuses to start if these locks remain from a crashed prior run.
    Cleans both top-level singleton locks and the ``Default/LOCK`` file.

    Args:
        profile_dir: Profile directory containing the locks.

    Returns:
        Number of lock entries removed.
    """
    profile_path = Path(profile_dir)
    if not profile_path.exists():
        return 0

    removed = 0

    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        lock_path = profile_path / name
        if not lock_path.exists():
            continue
        try:
            if lock_path.is_dir():
                shutil.rmtree(lock_path, ignore_errors=True)
            else:
                lock_path.unlink()
            logger.debug("Removed stale lock: %s", name)
            removed += 1
        except Exception as e:  # noqa: BLE001 — best-effort cleanup
            logger.debug("Could not remove %s: %s", name, e)

    default_lock = profile_path / "Default" / "LOCK"
    if default_lock.exists():
        try:
            default_lock.unlink()
            logger.debug("Removed Default/LOCK")
            removed += 1
        except Exception as e:  # noqa: BLE001
            logger.debug("Could not remove Default/LOCK: %s", e)

    return removed


__all__ = [
    "kill_chrome_for_profile",
    "capture_chrome_pids_for_profile",
    "cleanup_chrome_lock_files",
]
