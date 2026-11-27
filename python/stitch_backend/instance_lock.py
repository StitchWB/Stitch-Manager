"""Single-instance lock scoped to the SQLite database file.

Context: backend instances on *different* ports (``STITCH_API_PORT``
override) used to share the same ``stitch.db`` silently — a sqlite
multi-writer hazard that corrupted probe lifecycle state during smoke runs
and fed the watchdog/port-fight fallout analysed in crashloop-analysis.md.
Port-conflict handling in the launcher only covers same-port conflicts; the
true fix is a lock scoped to the DB file itself, acquired by the backend
lifespan BEFORE the first DB write.

Mechanism: an OS-level exclusive lock on ``<db-stem>.instance.lock`` next to
the database file (``msvcrt.locking`` byte-range lock on Windows,
``fcntl.flock`` elsewhere).  Kernel-held locks are released automatically
when the owning process dies — even on a hard kill — so the lock is
crash-resilient by construction and no stale-lock cleanup is ever needed.
The JSON payload (pid/port/started_at) inside the file is informational: it
makes the refusal error actionable (who holds it, since when) and powers
the pid-liveness note in that message.

The file is deliberately never deleted: unlinking would open a race where
one process recreates the file while another still holds a lock on the
unlinked inode/handle.  A leftover 200-byte file is harmless.

Escape hatch: ``STITCH_ALLOW_MULTI_INSTANCE=1`` skips acquisition entirely
(integration-test scenarios only) with a loud warning.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

if sys.platform == "win32":
    import msvcrt
else:
    import fcntl

logger = logging.getLogger(__name__)

ALLOW_MULTI_INSTANCE_ENV = "STITCH_ALLOW_MULTI_INSTANCE"

# Byte range locked on Windows (msvcrt).  Deliberately NOT offset 0: Windows
# byte-range locks are mandatory — locking payload bytes would make the lock
# file unreadable even for diagnostics.  Locking beyond EOF is legal
# (LockFileEx) and the payload stays readable at offset 0.  POSIX flock is
# whole-file and advisory, so the offset is irrelevant there.
_LOCK_OFFSET = 4096
_LOCK_BYTES = 1


class InstanceLockHeldError(RuntimeError):
    """Raised when another live backend instance already owns the DB lock."""

    def __init__(self, message: str, *, holder: InstanceLockInfo | None) -> None:
        super().__init__(message)
        self.holder = holder


@dataclass
class InstanceLockInfo:
    """Parsed payload of a held lock file (best-effort diagnostics)."""

    pid: int | None
    port: int | None
    started_at: str | None


def lock_path_for_db(db_path: Path) -> Path:
    """Lock file location for a given SQLite database file."""
    return db_path.parent / f"{db_path.stem}.instance.lock"


def _sqlite_file_path(database_url: str) -> Path | None:
    """Filesystem path of a file-backed SQLite URL; None otherwise."""
    if not database_url.startswith("sqlite"):
        return None
    if ":///" not in database_url:
        return None
    database = database_url.split(":///", 1)[1]
    # Query strings (e.g. ?mode=memory) and memory databases are per-process
    # by construction — there is no shared file to protect.
    database = database.split("?", 1)[0]
    if not database or database.startswith((":memory:", "file:memorydb")):
        return None
    return Path(database)


def _pid_alive(pid: int | None) -> bool:
    if pid is None or pid <= 0:
        return False
    try:
        import psutil

        return bool(psutil.pid_exists(pid))
    except Exception:  # noqa: BLE001 — diagnostics only, never fatal
        if sys.platform == "win32":
            return True  # unknown — assume alive (safer reporting default)
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True


def _os_lock(fd: int) -> None:
    """Acquire the non-blocking exclusive OS lock; raises OSError if held."""
    if sys.platform == "win32":
        os.lseek(fd, _LOCK_OFFSET, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_NBLCK, _LOCK_BYTES)
    else:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def _os_unlock(fd: int) -> None:
    if sys.platform == "win32":
        os.lseek(fd, _LOCK_OFFSET, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, _LOCK_BYTES)
    else:
        fcntl.flock(fd, fcntl.LOCK_UN)


def _read_holder_info(lock_path: Path) -> InstanceLockInfo | None:
    try:
        payload = json.loads(lock_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    pid = payload.get("pid")
    port = payload.get("port")
    started_at = payload.get("started_at")
    return InstanceLockInfo(
        pid=pid if isinstance(pid, int) else None,
        port=port if isinstance(port, int) else None,
        started_at=started_at if isinstance(started_at, str) else None,
    )


class InstanceLock:
    """Held OS-level instance lock.  Release is idempotent."""

    def __init__(self, fd: int, path: Path) -> None:
        self._fd: int | None = fd
        self._path = path

    @property
    def path(self) -> Path:
        return self._path

    def release(self) -> None:
        fd, self._fd = self._fd, None
        if fd is None:
            return
        try:
            _os_unlock(fd)
        except OSError:
            logger.debug("instance lock unlock failed (already released?)", exc_info=True)
        try:
            os.close(fd)
        except OSError:
            logger.debug("instance lock fd close failed", exc_info=True)

    def __enter__(self) -> InstanceLock:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.release()

    def __del__(self) -> None:  # safety net; explicit release() is the contract
        try:
            self.release()
        except Exception:  # noqa: BLE001 — __del__ must never raise
            pass


def _write_payload(fd: int, port: int) -> None:
    payload = {
        "pid": os.getpid(),
        "port": port,
        "started_at": datetime.now(UTC).isoformat(),
    }
    encoded = json.dumps(payload).encode("utf-8")
    os.lseek(fd, 0, os.SEEK_SET)
    os.write(fd, encoded)
    try:
        os.ftruncate(fd, len(encoded))
    except OSError:
        pass  # informational content; truncation is cosmetic


def _env_override_active() -> bool:
    return os.environ.get(ALLOW_MULTI_INSTANCE_ENV, "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def acquire_instance_lock(database_url: str, port: int) -> InstanceLock | None:
    """Acquire the single-instance lock for a file-backed SQLite database.

    Returns the held lock, or ``None`` when locking is not applicable:
    non-SQLite / in-memory databases (no shared file hazard) or the explicit
    ``STITCH_ALLOW_MULTI_INSTANCE`` escape hatch.

    Raises :class:`InstanceLockHeldError` when another live process holds
    the lock for the same database file.
    """
    db_path = _sqlite_file_path(database_url)
    if db_path is None:
        return None

    if _env_override_active():
        logger.warning(
            "⚠ MULTI-INSTANCE OVERRIDE ACTIVE (%s=1) — the single-instance DB lock is "
            "DISABLED. Concurrent writers on %s can corrupt probe lifecycle state. "
            "Use for integration testing only.",
            ALLOW_MULTI_INSTANCE_ENV,
            db_path,
        )
        return None

    lock_path = lock_path_for_db(db_path)
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    fd = os.open(str(lock_path), os.O_RDWR | os.O_CREAT, 0o644)
    try:
        _os_lock(fd)
    except OSError:
        holder = _read_holder_info(lock_path)
        os.close(fd)
        raise _held_error(lock_path, db_path, holder) from None

    try:
        _write_payload(fd, port)
    except OSError:
        # Payload is informational — never fail startup over diagnostics.
        logger.debug("could not write instance lock payload", exc_info=True)

    logger.info(
        "Single-instance lock acquired: %s (pid=%d port=%d)",
        lock_path,
        os.getpid(),
        port,
    )
    return InstanceLock(fd, lock_path)


def _held_error(
    lock_path: Path, db_path: Path, holder: InstanceLockInfo | None
) -> InstanceLockHeldError:
    if holder is not None and holder.pid is not None:
        liveness = "alive" if _pid_alive(holder.pid) else "dead (unexpected — report a bug)"
        holder_desc = (
            f"pid {holder.pid} ({liveness}), port {holder.port}, "
            f"started {holder.started_at}"
        )
    else:
        holder_desc = "unreadable lock payload — another process holds the OS lock"
    message = (
        f"Another Stitch backend instance already owns database {db_path} "
        f"({holder_desc}). SQLite is single-writer: concurrent instances corrupt "
        "probe lifecycle state. Either stop the other instance, point this one at a "
        f"different database (DATABASE_URL / -DbPath), or — integration tests only — "
        f"set {ALLOW_MULTI_INSTANCE_ENV}=1 to bypass this guard. "
        f"Lock file: {lock_path}"
    )
    return InstanceLockHeldError(message, holder=holder)
