"""Machine ID generation and IDE patching.

Generates unique hardware-like identifiers and patches IDE configuration
files to bind accounts to specific machines.
"""

from __future__ import annotations

import hashlib
import logging
import platform
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def generate_machine_id(seed: str = "") -> str:
    """Generate a deterministic or random machine UUID.

    If ``seed`` is provided, the ID is deterministic (SHA-256 based).
    Otherwise a random UUID4 is returned.
    """
    if seed:
        return hashlib.sha256(seed.encode()).hexdigest()[:36]
    return str(uuid.uuid4())


async def patch_machine_id(
    account_id: str,
    machine_id: str,
    ide: str = "kiro",
) -> dict[str, Any]:
    """Patch the IDE config to use the given machine ID.

    This is provider-specific.  Each IDE stores its machine binding
    in a different location.
    """
    IDE_PATHS = {
        "kiro": Path.home() / ".kiro" / "machineId",
        "windsurf": Path.home() / ".windsurf" / "machineId",
        "cursor": Path.home() / ".cursor" / "machineId",
    }

    path = IDE_PATHS.get(ide)
    if path is None:
        logger.warning("Unknown IDE '%s' — skipping machine ID patch", ide)
        return {"success": False, "error": f"Unknown IDE: {ide}"}

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(machine_id, encoding="utf-8")
        logger.info("Machine ID patched for %s: %s", ide, machine_id)
        return {"success": True, "machineId": machine_id, "ide": ide}
    except Exception as exc:
        logger.exception("Failed to patch machine ID for %s", ide)
        return {"success": False, "error": str(exc)}


async def get_machine_id(account_id: str, ide: str = "kiro") -> str | None:
    """Read the current machine ID for an IDE."""
    IDE_PATHS = {
        "kiro": Path.home() / ".kiro" / "machineId",
        "windsurf": Path.home() / ".windsurf" / "machineId",
        "cursor": Path.home() / ".cursor" / "machineId",
    }
    path = IDE_PATHS.get(ide)
    if path and path.exists():
        return path.read_text(encoding="utf-8").strip()
    return None
