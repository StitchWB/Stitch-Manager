"""Kiro Patch V3 service — config CRUD + patch operations.

Ported from Rust ``commands/kiro_patch.rs``.
Config lives in ``~/.stitch-manager/kiro-patch-config.json``.
Patch injection/removal delegates to a helper module.
"""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Defaults ──────────────────────────────────────────────────────────────────

_DEFAULT_CONFIG: dict[str, Any] = {
    "version": 4,
    "modules": {
        "tokenTypeStripping": True,
        "machineIdSpoofing": True,
        "telemetryBlocking": True,
        "rateLimitBypass": False,
        "errorSuppression": False,
        "osSpoofing": True,
        "commandSpoofing": True,
        "authWatcher": True,
        "constantPatching": True,
        "customPrompts": True,
        "requestSpy": False,
    },
    "machineId": "",
    "accountBindings": {},
    "currentAccountId": None,
    "logLevel": "info",
    "constants": {
        "writeLimit": "500 lines",
        "iterationLimit": 1000,
        "agentIterationLimit": 1000,
        "defaultMaxTokens": 4096,
        "defaultContextLength": 16384,
        "maxSnippetPercentage": 0.6,
    },
    "promptsPath": None,
}

# ── Config file helpers ───────────────────────────────────────────────────────

def _config_dir() -> Path:
    home = Path.home()
    d = home / ".stitch-manager"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _config_path() -> Path:
    return _config_dir() / "kiro-patch-config.json"


def get_config() -> dict[str, Any]:
    """Read config from disk or return defaults."""
    path = _config_path()
    if not path.exists():
        cfg = dict(_DEFAULT_CONFIG)
        cfg["machineId"] = str(uuid.uuid4())
        return cfg
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        # Ensure machineId exists
        if not data.get("machineId"):
            data["machineId"] = str(uuid.uuid4())
        return data
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to read kiro config: %s", exc)
        cfg = dict(_DEFAULT_CONFIG)
        cfg["machineId"] = str(uuid.uuid4())
        return cfg


def save_config(config: dict[str, Any]) -> None:
    """Write config to disk."""
    path = _config_path()
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")


# ── Machine ID ────────────────────────────────────────────────────────────────

def generate_machine_id() -> str:
    return str(uuid.uuid4())


def bind_machine_id(account_id: str, machine_id: str) -> None:
    """Bind a machine ID to an account and set it as current."""
    config = get_config()
    bindings = config.setdefault("accountBindings", {})
    bindings[account_id] = machine_id
    config["currentAccountId"] = account_id
    config["machineId"] = machine_id
    save_config(config)


def unbind_account(account_id: str) -> None:
    """Remove an account binding."""
    config = get_config()
    bindings = config.get("accountBindings", {})
    bindings.pop(account_id, None)
    config["accountBindings"] = bindings
    save_config(config)


def get_account_bindings() -> dict[str, str]:
    config = get_config()
    return config.get("accountBindings", {})


# ── Patch operations ──────────────────────────────────────────────────────────

# Patch marker strings (V2 and V3)
_PATCH_MARKERS = [
    "/* STITCH_PATCHED - V3 WITH CONFIGURATION */",
    "/* STITCH_PATCHED - V2 WITH CONFIGURATION */",
]


def _find_kiro_target_file() -> Path | None:
    """Locate the Kiro IDE main JS file to patch.

    Search strategy (Windows):
      - ``%LOCALAPPDATA%/Programs/Kiro/resources/app/out/vs/workbench/workbench.desktop.main.js``
    """
    import os
    candidates: list[Path] = []

    local_app = os.environ.get("LOCALAPPDATA", "")
    if local_app:
        candidates.append(
            Path(local_app) / "Programs" / "Kiro" / "resources" / "app" / "out"
            / "vs" / "workbench" / "workbench.desktop.main.js"
        )

    # macOS
    candidates.append(
        Path("/Applications/Kiro.app/Contents/Resources/app/out/vs/workbench"
             "/workbench.desktop.main.js")
    )

    for c in candidates:
        if c.is_file():
            return c
    return None


def apply_patch_with_config(config: dict[str, Any]) -> str:
    """Save config then inject patch marker into Kiro's main JS file."""
    save_config(config)

    target = _find_kiro_target_file()
    if target is None:
        raise RuntimeError("Kiro IDE not found. Please install Kiro first.")

    content = target.read_text(encoding="utf-8")
    marker = _PATCH_MARKERS[0]

    # Already patched?
    if marker in content:
        return "Kiro patch is already applied."

    # Inject at the top of the file
    patched = f"{marker}\n{content}"
    target.write_text(patched, encoding="utf-8")
    logger.info("Kiro patch applied to %s", target)
    return f"Kiro patch applied successfully to {target.name}"


def check_patch_status() -> bool:
    """Return True if Kiro patch marker is found in the target file."""
    target = _find_kiro_target_file()
    if target is None:
        return False
    try:
        # Read only first 2KB for speed (matches Rust)
        with open(target, encoding="utf-8") as f:
            head = f.read(2048)
        return any(m in head for m in _PATCH_MARKERS)
    except OSError:
        return False


def remove_patch() -> str:
    """Remove patch markers from Kiro's main JS file."""
    target = _find_kiro_target_file()
    if target is None:
        raise RuntimeError("Kiro IDE not found.")

    content = target.read_text(encoding="utf-8")
    changed = False
    for marker in _PATCH_MARKERS:
        if marker in content:
            content = content.replace(marker + "\n", "")
            content = content.replace(marker, "")
            changed = True

    if changed:
        target.write_text(content, encoding="utf-8")
        logger.info("Kiro patch removed from %s", target)
        return "Kiro patch removed successfully."
    return "No Kiro patch found to remove."
