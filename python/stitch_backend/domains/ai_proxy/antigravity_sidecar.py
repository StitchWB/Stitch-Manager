"""Antigravity plugin child-env shim.

The ``stitch-antigravity`` plugin child runs with a sandbox-scoped
USERPROFILE (sidecar supervisor ``_child_env``), so ``Path.home()`` inside
the plugin does not see the real user home.  The auth-file scanner therefore
reads STITCH_AUTH_DIR / STITCH_CONFIG_DIR from its environment; this module
resolves those dirs HERE, in the core process, and discovery injects them
into the plugin child env (mirrors ``freemodel_child_env``).
"""

from __future__ import annotations

from pathlib import Path


def antigravity_child_env() -> dict[str, str]:
    """Absolute auth/config dirs when they exist, ``{}`` otherwise."""
    home = Path.home()
    auth_dir = home / ".stitch-manager" / "auth"
    config_dir = home / ".config" / "stitch"
    env: dict[str, str] = {}
    if auth_dir.is_dir():
        env["STITCH_AUTH_DIR"] = str(auth_dir)
    if config_dir.is_dir():
        env["STITCH_CONFIG_DIR"] = str(config_dir)
    return env
