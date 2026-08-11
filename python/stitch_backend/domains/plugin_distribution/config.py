"""Plugin distribution client config (plan §4.5).

Reads ``STITCH_SERVER_URL`` from the environment directly — the existing
``stitch_backend.config.Settings`` model is NOT modified (per task scope).
Empty URL = standalone mode: plugins-local only, no sync, no heartbeat.

The activation file lives at ``<data_dir>/.activation`` where ``<data_dir>``
is the stitch-manager data dir.  ``STITCH_PLUGINS_DIR`` overrides the base
dir for tests (same convention as ``autoreg.plugin.layout``).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from stitch_backend.config import _app_data_dir

_ACTIVATION_FILENAME = ".activation"

logger = logging.getLogger(__name__)


def server_url() -> str:
    """Return the configured server URL (no trailing slash), or "" for standalone."""
    return os.environ.get("STITCH_SERVER_URL", "").rstrip("/")


def standalone_mode() -> bool:
    """True when no server URL is configured — plugins-local only, no sync."""
    return not server_url()


def data_dir() -> Path:
    """The stitch-manager data dir (base for .activation + plugins/).

    Honors ``STITCH_PLUGINS_DIR`` (tests / portable installs) — same
    convention as ``autoreg.plugin.layout._base_dir``.
    """
    override = os.environ.get("STITCH_PLUGINS_DIR")
    if override:
        return Path(override)
    return _app_data_dir() / "stitch-manager"


def activation_file_path() -> Path:
    """Path to the ``.activation`` JSON file (chmod 0600 best-effort)."""
    return data_dir() / _ACTIVATION_FILENAME


def offline_grace_days() -> int:
    """Days a client may run offline before entering degraded mode (default 7).

    Reads ``STITCH_OFFLINE_GRACE_DAYS``; non-integer or negative values log a
    warning and fall back to 7 (plan §3.2 item 8).
    """
    raw = os.environ.get("STITCH_OFFLINE_GRACE_DAYS")
    if raw is None:
        return 7
    try:
        days = int(raw)
    except (TypeError, ValueError):
        logger.warning(
            "Invalid STITCH_OFFLINE_GRACE_DAYS=%r — falling back to 7", raw
        )
        return 7
    if days < 0:
        logger.warning(
            "Negative STITCH_OFFLINE_GRACE_DAYS=%d — falling back to 7", days
        )
        return 7
    return days
