"""TOFU pin store for source-installed community plugins (plan §3.5 addendum).

Per-install state file ``<app_data>/plugin_pins.json`` maps plugin_id to::

    {
        "sha": "<commit_sha or release sha256>",
        "url": "<source url>",
        "installed_at": "<iso8601 utc>"
    }

Trust-on-first-use: the first install of a plugin_id records its pin.
Subsequent installs of the same plugin_id must produce the same sha unless
``force=True`` is passed (the user acknowledges the pin change).  This
prevents silent source swaps — a compromised catalog entry pointing at a
different git ref or release tarball is surfaced as a visible pin mismatch.

The pin value is:
  - **git mode**: the commit SHA pinned into ``.source.json`` by
    :func:`sources._fetch_git` (read via :func:`sources._read_sidecar_sha`).
  - **release mode**: the ``expected_sha256`` from the catalog entry
    (verified by :func:`sources._fetch_release` before extract).

All functions here are pure (no I/O except the json file) and unit-testable
without touching the network or the install machinery.

``check_and_record`` and ``check_and_record_scoped`` wrap the read-then-write
critical section with a cross-process file lock (``msvcrt.locking`` on
Windows / ``fcntl.flock`` on POSIX) so concurrent installs cannot both pass
the TOFU check and both record — exactly one wins, the other sees the
recorded pin.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from .config import data_dir

if TYPE_CHECKING:
    from pathlib import Path

_PINS_FILENAME = "plugin_pins.json"

#: Timeout (seconds) for acquiring the cross-process pin lock.
_PIN_LOCK_TIMEOUT: float = 5.0


def _pins_file_path() -> Path:
    """Return the path to the plugin pins file (beside app data)."""
    return data_dir() / _PINS_FILENAME


def load_pins() -> dict[str, dict[str, Any]]:
    """Read the pins file.

    Returns an empty dict when the file is missing or corrupt (never raises).
    """
    path = _pins_file_path()
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return raw


def save_pins(pins: dict[str, dict[str, Any]]) -> None:
    """Atomically write the pins file (tmp + os.replace)."""
    path = _pins_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{_PINS_FILENAME}.tmp.{os.getpid()}"
    tmp.write_text(
        json.dumps(pins, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(tmp, path)


def get_pin(plugin_id: str) -> dict[str, Any] | None:
    """Return the recorded pin for ``plugin_id``, or ``None``."""
    return load_pins().get(plugin_id)


def check_pin(plugin_id: str, new_sha: str) -> tuple[bool, str | None]:
    """Check whether installing ``plugin_id`` with ``new_sha`` is allowed.

    Returns ``(ok, error_message)``:
      - No prior pin → ``(True, None)``
      - Prior pin with the same sha → ``(True, None)``
      - Prior pin with a different sha → ``(False, message)`` — the message
        names both shas so the user can audit the change.
    """
    prior = get_pin(plugin_id)
    if prior is None:
        return True, None
    old_sha = prior.get("sha", "")
    if old_sha == new_sha:
        return True, None
    return False, (
        f"pin mismatch for {plugin_id}: recorded sha {old_sha[:12]}…, "
        f"new sha {new_sha[:12]}… — pass force=True to accept the change"
    )


def record_pin(plugin_id: str, *, sha: str, url: str) -> None:
    """Record or replace the pin for ``plugin_id``."""
    pins = load_pins()
    pins[plugin_id] = {
        "sha": sha,
        "url": url,
        "installed_at": datetime.now(UTC).isoformat(),
    }
    save_pins(pins)


@contextlib.contextmanager
def _pin_lock(pins_file: Path, *, timeout: float = _PIN_LOCK_TIMEOUT):
    """Acquire a cross-process file lock for the pins critical section.

    Uses ``msvcrt.locking`` on Windows and ``fcntl.flock`` on POSIX.  The
    lock file is ``<pins_file>.lock``.  Raises ``TimeoutError`` when the
    lock cannot be acquired within ``timeout`` seconds (another process is
    holding it — the caller should surface this as a clear error).
    """
    lock_path = pins_file.with_suffix(pins_file.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(lock_path), os.O_RDWR | os.O_CREAT, 0o644)
    try:
        deadline = time.monotonic() + timeout
        while True:
            try:
                if sys.platform == "win32":
                    import msvcrt

                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError as err:
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"could not acquire pin lock {lock_path} within "
                        f"{timeout}s - another install is in progress"
                    ) from err
                time.sleep(0.05)
        try:
            yield
        finally:
            try:
                if sys.platform == "win32":
                    import msvcrt

                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(fd, fcntl.LOCK_UN)
            except OSError:
                pass
    finally:
        try:
            os.close(fd)
        except OSError:
            pass


def check_and_record(
    plugin_id: str,
    *,
    new_sha: str,
    url: str,
    force: bool = False,
) -> tuple[bool, str | None]:
    """Check the TOFU pin and record on success (atomic under a file lock).

    Returns ``(ok, error_message)``.  When ``ok`` is ``True``, the pin is
    recorded (replacing any prior pin).  When ``ok`` is ``False``, no state
    is changed — the caller must refuse the install.

    The read-then-write critical section is wrapped in a cross-process file
    lock so concurrent installs of the same ``plugin_id`` cannot both pass
    the TOFU check: the first caller acquires the lock, checks, records,
    releases; the second acquires the lock, sees the recorded pin, and
    either succeeds (same sha) or fails (different sha).
    """
    with _pin_lock(_pins_file_path()):
        ok, msg = check_pin(plugin_id, new_sha)
        if not ok and not force:
            return False, msg
        record_pin(plugin_id, sha=new_sha, url=url)
        return True, None


# ── Scoped (per-user sandbox) pins ───────────────────────────────────────────
#
# Sandbox installs are keyed by ``(user_id, plugin_id)`` so each user has
# their own TOFU pin independent of the global pin store.  Stored in a
# separate file (``sandbox_plugin_pins.json``) so the global pins file is
# untouched and the two stores never collide.

_SCOPED_PINS_FILENAME = "sandbox_plugin_pins.json"


def _scoped_pins_file_path() -> Path:
    """Return the path to the scoped (sandbox) pins file."""
    return data_dir() / _SCOPED_PINS_FILENAME


def _scoped_key(user_id: int, plugin_id: str) -> str:
    """Composite key for the scoped pins file: ``<user_id>/<plugin_id>``."""
    return f"{user_id}/{plugin_id}"


def load_scoped_pins() -> dict[str, dict[str, Any]]:
    """Read the scoped pins file (empty dict on missing/corrupt, never raises)."""
    path = _scoped_pins_file_path()
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return raw


def save_scoped_pins(pins: dict[str, dict[str, Any]]) -> None:
    """Atomically write the scoped pins file (tmp + os.replace)."""
    path = _scoped_pins_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{_SCOPED_PINS_FILENAME}.tmp.{os.getpid()}"
    tmp.write_text(
        json.dumps(pins, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(tmp, path)


def get_scoped_pin(user_id: int, plugin_id: str) -> dict[str, Any] | None:
    """Return the recorded scoped pin for ``(user_id, plugin_id)`` or ``None``."""
    return load_scoped_pins().get(_scoped_key(user_id, plugin_id))


def check_scoped_pin(
    user_id: int, plugin_id: str, new_sha: str
) -> tuple[bool, str | None]:
    """Check whether installing ``(user_id, plugin_id)`` with ``new_sha`` is allowed."""
    prior = get_scoped_pin(user_id, plugin_id)
    if prior is None:
        return True, None
    old_sha = prior.get("sha", "")
    if old_sha == new_sha:
        return True, None
    return False, (
        f"pin mismatch for {plugin_id} (user {user_id}): recorded sha "
        f"{old_sha[:12]}…, new sha {new_sha[:12]}… — pass force=True to accept"
    )


def record_scoped_pin(
    user_id: int, plugin_id: str, *, sha: str, url: str
) -> None:
    """Record or replace the scoped pin for ``(user_id, plugin_id)``."""
    pins = load_scoped_pins()
    pins[_scoped_key(user_id, plugin_id)] = {
        "sha": sha,
        "url": url,
        "installed_at": datetime.now(UTC).isoformat(),
    }
    save_scoped_pins(pins)


def remove_scoped_pin(user_id: int, plugin_id: str) -> None:
    """Remove the scoped pin for ``(user_id, plugin_id)`` (no-op if absent)."""
    pins = load_scoped_pins()
    key = _scoped_key(user_id, plugin_id)
    if key in pins:
        del pins[key]
        save_scoped_pins(pins)


def check_and_record_scoped(
    user_id: int,
    plugin_id: str,
    *,
    new_sha: str,
    url: str,
    force: bool = False,
) -> tuple[bool, str | None]:
    """Check the scoped TOFU pin and record on success (atomic under a file lock).

    Mirrors :func:`check_and_record` but for the scoped (per-user sandbox)
    pin store.  The read-then-write critical section is wrapped in a
    cross-process file lock so concurrent installs of the same
    ``(user_id, plugin_id)`` cannot both pass the TOFU check.
    """
    with _pin_lock(_scoped_pins_file_path()):
        ok, msg = check_scoped_pin(user_id, plugin_id, new_sha)
        if not ok and not force:
            return False, msg
        record_scoped_pin(user_id, plugin_id, sha=new_sha, url=url)
        return True, None
