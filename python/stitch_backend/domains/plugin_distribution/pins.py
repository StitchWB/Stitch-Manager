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
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import data_dir

_PINS_FILENAME = "plugin_pins.json"


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
        "installed_at": datetime.now(timezone.utc).isoformat(),
    }
    save_pins(pins)


def check_and_record(
    plugin_id: str,
    *,
    new_sha: str,
    url: str,
    force: bool = False,
) -> tuple[bool, str | None]:
    """Check the TOFU pin and record on success.

    Returns ``(ok, error_message)``.  When ``ok`` is ``True``, the pin is
    recorded (replacing any prior pin).  When ``ok`` is ``False``, no state
    is changed — the caller must refuse the install.
    """
    ok, msg = check_pin(plugin_id, new_sha)
    if not ok and not force:
        return False, msg
    record_pin(plugin_id, sha=new_sha, url=url)
    return True, None
