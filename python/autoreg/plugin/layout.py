"""Plugin data-directory layout (plan §4.5).

Mirrors the OS-specific ``_app_data_dir()`` convention from
``stitch_backend.config`` (Windows: ``%LOCALAPPDATA%``, macOS:
``~/Library/Application Support``, Linux: ``~/.local/share``).  The
stitch-manager data dir is ``<app_data_dir>/stitch-manager``.

Three subdirs:
    plugins-local/   — dev source (unsigned packages allowed in dev_mode)
    plugins/         — server cache, layout ``plugins/{id}/{version}/``
    plugins/.staging — atomic-install staging area

``STITCH_PLUGINS_DIR`` env var overrides the base dir for tests so they
never touch the real user data dir.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Subdirectory names — single source of truth.
_LOCAL_SUBDIR = "plugins-local"
_CACHE_SUBDIR = "plugins"
_STAGING_SUBDIR = ".staging"


def _app_data_dir() -> Path:
    """Return the OS-specific local app-data directory.

    Mirrors ``stitch_backend.config._app_data_dir`` and the Rust
    ``dirs::data_local_dir`` convention.  Duplicated here so the plugin
    package has no dependency on ``stitch_backend`` (which uses pydantic v2
    — autoreg is plain Python 3.11 dataclasses only).
    """
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            return Path(local)
        return Path.home() / "AppData" / "Local"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support"
    return Path.home() / ".local" / "share"


def _base_dir() -> Path:
    """Base dir for all plugin data.

    Honors ``STITCH_PLUGINS_DIR`` (tests / portable installs).  Falls back
    to ``<app_data_dir>/stitch-manager`` to match the rest of the app.
    """
    override = os.environ.get("STITCH_PLUGINS_DIR")
    if override:
        return Path(override)
    return _app_data_dir() / "stitch-manager"


def plugins_local_dir() -> Path:
    """Dev source dir: ``<base>/plugins-local``.

    Layout: ``plugins-local/{plugin_id}/`` — one package per plugin id,
    no version subdir (dev source, single working copy).
    """
    return _base_dir() / _LOCAL_SUBDIR


def plugins_cache_dir() -> Path:
    """Server cache dir: ``<base>/plugins``.

    Layout: ``plugins/{plugin_id}/{version}/`` — multiple versions per
    plugin id, newest wins at resolution time.
    """
    return _base_dir() / _CACHE_SUBDIR


def staging_dir() -> Path:
    """Atomic-install staging dir: ``<base>/plugins/.staging``.

    Installers copy a candidate package here, verify signature+hash, then
    atomic-rename into ``plugins/{id}/{version}/``.
    """
    return plugins_cache_dir() / _STAGING_SUBDIR


def plugin_cache_path(plugin_id: str, version: str) -> Path:
    """Canonical cache path for a specific plugin version."""
    return plugins_cache_dir() / plugin_id / version


def plugin_local_path(plugin_id: str) -> Path:
    """Canonical local-dev path for a plugin id."""
    return plugins_local_dir() / plugin_id


# ── Sandbox (per-user) layout ───────────────────────────────────────────────
#
# Sandbox plugins live under ``<base>/sandbox/<user_id>/<plugin_id>/`` and are
# visible only to their owner.  The data dir is kept beside the package dir
# with a ``-data`` suffix so uninstalling the package never nukes the data
# dir in one rmtree (the lifecycle code removes them independently).

_SANDBOX_SUBDIR = "sandbox"


def sandbox_dir() -> Path:
    """Root dir for all per-user sandbox plugins: ``<base>/sandbox``."""
    return _base_dir() / _SANDBOX_SUBDIR


def sandbox_user_dir(user_id: int) -> Path:
    """Per-user sandbox root: ``<base>/sandbox/<user_id>``."""
    return sandbox_dir() / str(user_id)


def sandbox_plugin_dir(user_id: int, plugin_id: str) -> Path:
    """Package dir for a user's sandbox plugin: ``<base>/sandbox/<uid>/<pid>``."""
    return sandbox_user_dir(user_id) / plugin_id


def sandbox_plugin_data_dir(user_id: int, plugin_id: str) -> Path:
    """Data dir for a user's sandbox plugin: ``<base>/sandbox/<uid>/<pid>-data``."""
    return sandbox_user_dir(user_id) / f"{plugin_id}-data"
