from __future__ import annotations

import shutil
from pathlib import Path


def velly_child_env() -> dict[str, str]:
    home = Path.home()
    roaming = home / "AppData" / "Roaming"
    profile = roaming / "Velly"
    env = {
        "STITCH_VELLY_PROFILE": str(profile),
        "STITCH_VELLY_OPENCODE_CONFIG": str(home / ".config" / "opencode" / "opencode.json"),
    }
    node = shutil.which("node")
    bundled = profile / "agent-tools" / "node" / "node.exe"
    if node:
        env["STITCH_VELLY_NODE"] = node
    elif bundled.is_file():
        env["STITCH_VELLY_NODE"] = str(bundled)
    return env
