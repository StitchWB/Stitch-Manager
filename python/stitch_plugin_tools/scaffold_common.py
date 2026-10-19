"""Shared constants and helpers for the plugin scaffold generators."""

from __future__ import annotations

import re
from typing import Any

# Bumped when the canonical conventions change (v3 = vendored rpc_server).
SCAFFOLD_VERSION = 3

# ``upgrade`` parses this marker to detect a package's scaffold generation.
MARKER_PREFIX = "# _generated_by: stitch_plugin_tools scaffold v"


def marker_line(version: int = SCAFFOLD_VERSION) -> str:
    """The ``_generated_by`` marker comment for a scaffold version."""
    return f"{MARKER_PREFIX}{version}"

# Plugin id charset (matches manifest._PLUGIN_ID_RE).
_PLUGIN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")

# ``upgrade`` rewrites exactly these generated fields; the rest is preserved.
CANONICAL_ENGINE: dict[str, Any] = {"min": "0.3.0", "api": 2}


def generated_by_field() -> dict[str, Any]:
    """Manifest ``generated_by`` extra for the current scaffold version."""
    return {"tool": "stitch_plugin_tools", "scaffold": SCAFFOLD_VERSION}


def _pkg_name(plugin_id: str) -> str:
    """Convert a plugin id to a valid Python package name.

    ``my-plugin`` -> ``my_plugin``.  The package name is a valid Python
    identifier used as ``entry.module`` in the manifest and the directory
    name for the Python package.
    """
    return plugin_id.replace("-", "_")


def _validate_plugin_id(plugin_id: str) -> str:
    """Raise ``ValueError`` if the id is not a safe plugin id."""
    if not _PLUGIN_ID_RE.match(plugin_id):
        raise ValueError(
            f"invalid plugin id {plugin_id!r}: must match [A-Za-z0-9_-] "
            "(no dots, no path separators)"
        )
    return plugin_id
