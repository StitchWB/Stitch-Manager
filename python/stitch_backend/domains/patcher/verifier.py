"""Verify patches were applied correctly."""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import cast

logger = logging.getLogger(__name__)


@dataclass
class VerificationResult:
    """Outcome of a patch verification."""

    valid: bool
    file_path: str
    checks_passed: int = 0
    checks_failed: int = 0
    details: list[str] | None = None

    def __post_init__(self) -> None:
        if self.details is None:
            self.details = []


def verify_binary_contains(file_path: Path, expected_bytes: bytes) -> bool:
    """Check that a binary file contains *expected_bytes*."""
    if not file_path.exists():
        return False
    return expected_bytes in file_path.read_bytes()


def verify_text_contains(file_path: Path, expected_text: str, encoding: str = "utf-8") -> bool:
    """Check that a text file contains *expected_text*."""
    if not file_path.exists():
        return False
    return expected_text in file_path.read_text(encoding=encoding)


def verify_json_key(file_path: Path, key: str, expected_value: object = None) -> bool:
    """Check that a JSON file has *key* (optionally with *expected_value*)."""
    import json

    if not file_path.exists():
        return False
    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return False
    if key not in data:
        return False
    if expected_value is not None:
        return cast("bool", data[key] == expected_value)
    return True


def file_checksum(path: Path) -> str | None:
    """Return SHA-256 hex digest of a file."""
    if not path.exists():
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_patch_set(
    checks: list[dict],
) -> VerificationResult:
    """Run a list of verification checks and aggregate the result.

    Each check dict has:
      - type: "binary_contains" | "text_contains" | "json_key"
      - file: path string
      - value: the bytes/str/dict to look for
    """
    passed = 0
    failed = 0
    details: list[str] = []

    for check in checks:
        ctype = check.get("type", "")
        fpath = Path(check["file"])
        value = check.get("value")

        if ctype == "binary_contains":
            ok = verify_binary_contains(fpath, cast("bytes", value))
        elif ctype == "text_contains":
            ok = verify_text_contains(fpath, cast("str", value))
        elif ctype == "json_key":
            ok = verify_json_key(fpath, check.get("key", ""), value)
        else:
            ok = False
            details.append(f"Unknown check type: {ctype}")

        if ok:
            passed += 1
        else:
            failed += 1
            details.append(f"FAIL: {ctype} on {fpath}")

    first_file = checks[0]["file"] if checks else ""
    return VerificationResult(
        valid=(failed == 0),
        file_path=first_file,
        checks_passed=passed,
        checks_failed=failed,
        details=details,
    )
