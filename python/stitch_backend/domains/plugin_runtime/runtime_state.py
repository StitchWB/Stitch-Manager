"""Persisted per-plugin runtime enablement (the user-disabled set).

Backs the ``set_service_plugin_enabled`` command: a disabled plugin keeps
its package, data dir and credentials (disable != uninstall) but its host
is stopped and discovery skips the autostart on every boot.  State lives
in ``<data_dir>/.plugin_runtime_state.json`` (same convention as
``.activation``), written with chmod 0600 best-effort on POSIX.
"""

from __future__ import annotations

import json
import logging
import os
import stat
from typing import TYPE_CHECKING

from stitch_backend.domains.plugin_distribution.config import data_dir

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

_STATE_FILENAME = ".plugin_runtime_state.json"


def state_file_path() -> Path:
    return data_dir() / _STATE_FILENAME


def load_disabled() -> set[str]:
    """Plugin ids the user disabled; empty set when absent or corrupt."""
    path = state_file_path()
    if not path.is_file():
        return set()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        logger.warning("Failed to load plugin runtime state: %s", exc)
        return set()
    disabled = raw.get("disabled_plugins") if isinstance(raw, dict) else None
    if not isinstance(disabled, list):
        return set()
    return {str(p) for p in disabled}


def is_plugin_disabled(plugin_id: str) -> bool:
    return plugin_id in load_disabled()


def set_plugin_disabled(plugin_id: str, disabled: bool) -> None:
    current = load_disabled()
    if disabled:
        current.add(plugin_id)
    else:
        current.discard(plugin_id)
    _save(current)


def _save(disabled: set[str]) -> None:
    path = state_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"disabled_plugins": sorted(disabled)}, indent=2) + "\n",
        encoding="utf-8",
    )
    if os.name == "posix":
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


__all__ = [
    "state_file_path",
    "load_disabled",
    "is_plugin_disabled",
    "set_plugin_disabled",
]
