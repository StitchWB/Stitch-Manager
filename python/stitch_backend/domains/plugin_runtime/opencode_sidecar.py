"""OpenCode plugin child-env shim.

The ``stitch-opencode`` plugin child runs with a sandbox-scoped
USERPROFILE (sidecar supervisor ``_child_env``), so ``Path.home()`` inside
the plugin does not see the real user home and the config page would
read/write a phantom ``~/.config/opencode`` under the sandbox.  The core
resolves the real dir HERE and discovery injects it as
STITCH_OPENCODE_CONFIG_DIR (mirrors ``antigravity_child_env``); the plugin
falls back to ``Path.home()`` when the var is absent.

Unlike the read-only antigravity scan, the dir is injected even when it
does not exist: the plugin's config writer creates it, so a fresh install
gets the real ``~/.config/opencode`` instead of a sandbox one.
"""

from __future__ import annotations

from pathlib import Path


def opencode_child_env() -> dict[str, str]:
    """Real ``~/.config/opencode`` path for the plugin child env."""
    return {"STITCH_OPENCODE_CONFIG_DIR": str(Path.home() / ".config" / "opencode")}
