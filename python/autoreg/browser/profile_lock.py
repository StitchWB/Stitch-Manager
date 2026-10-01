"""File lock on a browser profile dir, with stale-lock and zombie-worker cleanup."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

# Logger name pinned to autoreg.browser.profile_launcher: log stream identity must survive the split.
logger = logging.getLogger("autoreg.browser.profile_launcher")


def profile_lock_path(profile_path: Path) -> Path:
    return profile_path / ".profile.lock"


def cleanup_stale_profile_lock(profile_path: Path, profile_id: str, worker_email: str) -> None:
    """Clean up stale profile lock file from previous crashed sessions.

    If the lock file is held by a live process (e.g. zombie open_browser.py
    worker), kills the process before deleting the file.
    """
    lock_path = profile_lock_path(profile_path)
    if not lock_path.exists():
        return

    # First attempt: simple unlink
    try:
        lock_path.unlink()
        return
    except (OSError, PermissionError):
        pass  # File is held by another process

    # Second attempt: find and kill zombie open_browser.py workers using this profile, then unlink again.
    import subprocess

    profile_str = str(profile_path)
    # Shard workers carry only --email/--profile-id on their command line; match those or elevated zombies survive.
    try:
        result = subprocess.run(
            ['wmic', 'process', 'where', 'name="python.exe"', 'get', 'ProcessId,CommandLine', '/format:csv'],
            capture_output=True, text=True, timeout=10,
        )
        for line in result.stdout.splitlines():
            if 'open_browser.py' in line and '--worker' in line and (
                profile_str in line
                or profile_id in line
                or (worker_email and worker_email in line)
            ):
                # CSV = Node,CommandLine,PID; CommandLine may contain commas (config-json), so PID is the LAST field.
                parts = line.strip().rsplit(',', 1)
                if len(parts) == 2 and parts[1].strip().isdigit():
                    pid = int(parts[1].strip())
                    if pid == os.getpid():
                        continue  # never kill ourselves
                    try:
                        subprocess.run(
                            ['taskkill', '/F', '/PID', str(pid)],
                            capture_output=True, timeout=5,
                        )
                        logger.info(f"Killed zombie open_browser worker PID {pid} for profile {profile_id}")
                    except Exception:
                        pass
    except Exception:
        pass

    # Try unlink again after killing
    try:
        lock_path.unlink()
    except Exception:
        pass


def acquire_profile_lock(profile_path: Path, profile_id: str, worker_email: str) -> Any:
    """Acquire profile lock with zombie-worker cleanup and short wait.

    1. Clean stale lock (kill zombie workers if needed).
    2. Try non-blocking acquire.
    3. If blocked, clean again and wait up to 5 seconds for active user.
    4. If still blocked, raise RuntimeError.
    """
    cleanup_stale_profile_lock(profile_path, profile_id, worker_email)

    try:
        from filelock import FileLock, Timeout
    except Exception as e:  # pragma: no cover
        raise RuntimeError("filelock is required for profile locking") from e

    profile_path.mkdir(parents=True, exist_ok=True)
    lock = FileLock(str(profile_lock_path(profile_path)))
    try:
        lock.acquire(timeout=0)
    except Timeout as e:
        # Stale lock may have been recreated by a zombie — kill and retry
        cleanup_stale_profile_lock(profile_path, profile_id, worker_email)
        try:
            lock.acquire(timeout=5)
        except Timeout:
            raise RuntimeError(
                f"Profile '{profile_id}' is already locked (in use). Path: {profile_path}"
            ) from e
    return lock


def release_profile_lock(lock: Any) -> None:
    if lock is None:
        return
    try:
        lock.release()
    except Exception:
        pass
