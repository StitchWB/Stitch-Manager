"""Apply patches to IDE installation files (binary and text)."""

from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class PatchResult:
    """Outcome of a patch operation."""

    success: bool
    file_path: str
    patches_applied: int = 0
    backup_path: str | None = None
    error: str | None = None


# ── Backup helpers ───────────────────────────────────────────────────────────

def create_backup(path: Path) -> Path:
    """Create a .bak backup of *path* and return its location."""
    backup = path.with_suffix(path.suffix + ".bak")
    shutil.copy2(path, backup)
    logger.debug("Backup created: %s", backup)
    return backup


def restore_backup(path: Path) -> bool:
    """Restore *path* from its .bak backup, if present."""
    backup = path.with_suffix(path.suffix + ".bak")
    if backup.exists():
        shutil.copy2(backup, path)
        logger.info("Restored %s from backup", path)
        return True
    return False


# ── Binary patching ──────────────────────────────────────────────────────────

def patch_binary(
    file_path: Path,
    replacements: list[tuple[bytes, bytes]],
    *,
    backup: bool = True,
) -> PatchResult:
    """Apply byte-level search-and-replace to a binary file.

    Each replacement is a ``(search_bytes, replace_bytes)`` tuple.
    The replacement **must** be the same length as the search bytes to avoid
    breaking offsets.
    """
    if not file_path.exists():
        return PatchResult(success=False, file_path=str(file_path), error="File not found")

    backup_path: str | None = None
    if backup:
        bk = create_backup(file_path)
        backup_path = str(bk)

    data = file_path.read_bytes()
    applied = 0

    for search, replace in replacements:
        if len(search) != len(replace):
            return PatchResult(
                success=False,
                file_path=str(file_path),
                backup_path=backup_path,
                error=f"Length mismatch: search={len(search)} replace={len(replace)}",
            )
        if search in data:
            data = data.replace(search, replace, 1)
            applied += 1

    file_path.write_bytes(data)
    logger.info("Binary patched %s — %d replacement(s)", file_path, applied)
    return PatchResult(success=True, file_path=str(file_path), patches_applied=applied, backup_path=backup_path)


# ── Text patching ────────────────────────────────────────────────────────────

def patch_text(
    file_path: Path,
    replacements: list[tuple[str, str]],
    *,
    backup: bool = True,
    encoding: str = "utf-8",
) -> PatchResult:
    """Apply text-level search-and-replace to a text file."""
    if not file_path.exists():
        return PatchResult(success=False, file_path=str(file_path), error="File not found")

    backup_path: str | None = None
    if backup:
        bk = create_backup(file_path)
        backup_path = str(bk)

    text = file_path.read_text(encoding=encoding)
    applied = 0

    for search, replace in replacements:
        if search in text:
            text = text.replace(search, replace, 1)
            applied += 1

    file_path.write_text(text, encoding=encoding)
    logger.info("Text patched %s — %d replacement(s)", file_path, applied)
    return PatchResult(success=True, file_path=str(file_path), patches_applied=applied, backup_path=backup_path)


# ── JSON config patching ────────────────────────────────────────────────────

def patch_json_config(
    file_path: Path,
    updates: dict,
    *,
    backup: bool = True,
) -> PatchResult:
    """Merge *updates* into a JSON config file."""
    import json

    if not file_path.exists():
        return PatchResult(success=False, file_path=str(file_path), error="File not found")

    backup_path: str | None = None
    if backup:
        bk = create_backup(file_path)
        backup_path = str(bk)

    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        return PatchResult(success=False, file_path=str(file_path), backup_path=backup_path, error=str(exc))

    data.update(updates)
    file_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    logger.info("JSON patched %s — %d key(s)", file_path, len(updates))
    return PatchResult(success=True, file_path=str(file_path), patches_applied=len(updates), backup_path=backup_path)
