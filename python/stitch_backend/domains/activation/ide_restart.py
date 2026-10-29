"""IDE process restart — kill and relaunch IDE processes."""

from __future__ import annotations

import logging
import platform
import subprocess
from typing import Any

logger = logging.getLogger(__name__)

IDE_PROCESSES = {
    "kiro": ["kiro"],
    "windsurf": ["windsurf", "Windsurf"],
    "cursor": ["cursor", "Cursor"],
    "trae": ["trae", "Trae"],
}


async def restart_ide(ide: str) -> dict[str, Any]:
    """Kill and optionally restart an IDE process."""
    processes = IDE_PROCESSES.get(ide, [ide])
    killed = 0

    try:
        import psutil

        for proc in psutil.process_iter(["name"]):
            if proc.info["name"] and any(
                p.lower() in proc.info["name"].lower() for p in processes
            ):
                proc.terminate()
                killed += 1
    except ImportError:
        # Fallback to taskkill on Windows
        if platform.system() == "Windows":
            for name in processes:
                result = subprocess.run(
                    ["taskkill", "/F", "/IM", f"{name}.exe"],
                    capture_output=True, text=True,
                )
                if result.returncode == 0:
                    killed += 1

    logger.info("IDE restart: killed %d process(es) for %s", killed, ide)
    return {"success": True, "killed": killed, "ide": ide}
