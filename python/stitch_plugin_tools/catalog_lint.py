"""Offline catalog validator for the stitch-plugin-catalog repo CI.

``stitch_plugin_tools catalog-lint <catalog.json>`` validates a catalog
file **offline** — it never fetches anything.  The catalog repo's CI
calls this on every PR to catch malformed entries before merge.

Rules:
  1. JSON must parse and be a dict with a ``plugins`` list.
  2. Each entry must be a dict with ``id`` (str) and ``version`` (str).
  3. Version must be semver (``MAJOR.MINOR.PATCH`` with optional pre-release).
  4. If ``source`` is present:
     - Must be a dict with ``type`` ∈ {``"git"``, ``"release"``}.
     - git: ``url`` required (str); ``ref`` optional, when present must be
       a non-empty string not starting with ``-`` (git injection hardening,
       mirrors ``sources._git_clone``).
     - release: ``url`` required (str) + ``sha256`` required (hex64).
     - Unknown ``type`` → error.
  5. Legacy entries (no ``source``): ``path`` (non-empty str) +
     ``sha256`` (hex64) required — the documented zip-era shape.
  6. Duplicate ``id`` + ``version`` pairs → error.

Exit 0 on success, 1 on any error.  A per-entry report is printed to stdout.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

# Semver: MAJOR.MINOR.PATCH with optional -prerelease (simplified).
_SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$")


def _is_hex64(s: str) -> bool:
    return len(s) == 64 and all(c in "0123456789abcdef" for c in s.lower())


def lint_entry(entry: Any) -> list[str]:
    """Return a list of error messages for a single catalog entry.

    An empty list means the entry is valid.  ``entry`` is the raw JSON
    value (not yet type-checked).
    """
    errors: list[str] = []

    if not isinstance(entry, dict):
        return [f"entry is not an object (got {type(entry).__name__})"]

    # Required fields.
    eid = entry.get("id")
    if not eid or not isinstance(eid, str):
        errors.append("missing or non-string 'id'")
    version = entry.get("version")
    if not version or not isinstance(version, str):
        errors.append("missing or non-string 'version'")
    elif not _SEMVER_RE.match(version):
        errors.append(f"version {version!r} is not semver (MAJOR.MINOR.PATCH)")

    # Source field (optional — legacy entries have none).
    source = entry.get("source")
    if source is None:
        # Legacy entry (zip-era, backward compatible).
        # Documented shape: path (non-empty str) + sha256 (hex64).
        path = entry.get("path")
        if not path or not isinstance(path, str):
            errors.append("legacy entry requires 'path'")
        sha256 = entry.get("sha256")
        if not sha256 or not isinstance(sha256, str):
            errors.append("legacy entry requires 'sha256'")
        elif not _is_hex64(sha256):
            errors.append("legacy entry 'sha256' must be hex64")
    elif not isinstance(source, dict):
        errors.append("'source' must be an object")
    else:
        stype = source.get("type")
        if stype == "git":
            url = source.get("url")
            if not url or not isinstance(url, str):
                errors.append("git source requires 'url'")
            # ref validation: when present, must be a non-empty string and
            # must not start with "-" (git argument injection hardening,
            # mirrors sources._git_clone).
            ref = source.get("ref")
            if ref is not None:
                if not isinstance(ref, str) or not ref:
                    errors.append("git source 'ref' must be a non-empty string")
                elif ref.startswith("-"):
                    errors.append("git source 'ref' must not start with '-'")
        elif stype == "release":
            url = source.get("url")
            if not url or not isinstance(url, str):
                errors.append("release source requires 'url'")
            sha256 = source.get("sha256")
            if not sha256 or not isinstance(sha256, str):
                errors.append("release source requires 'sha256'")
            elif not _is_hex64(sha256):
                errors.append("release source 'sha256' must be hex64")
        else:
            errors.append(f"unknown source type: {stype!r}")

    return errors


def lint_catalog(catalog_path: str | Path) -> int:
    """Validate a catalog file offline.  Returns exit code (0=ok, 1=error).

    Prints a per-entry report to stdout and errors to stderr.
    """
    path = Path(catalog_path)
    if not path.is_file():
        print(f"error: catalog file not found: {path}", file=sys.stderr)
        return 1

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"error: JSON parse failed: {exc}", file=sys.stderr)
        return 1

    if not isinstance(raw, dict):
        print("error: catalog root must be an object", file=sys.stderr)
        return 1

    plugins = raw.get("plugins")
    if not isinstance(plugins, list):
        print("error: catalog must have a 'plugins' array", file=sys.stderr)
        return 1

    seen: dict[str, int] = {}  # "id@version" → entry index
    total_errors = 0
    entries_ok = 0

    for i, entry in enumerate(plugins):
        label = f"entry[{i}]"
        if isinstance(entry, dict) and entry.get("id") and entry.get("version"):
            label = f"entry[{i}] {entry['id']}@{entry['version']}"

        errs = lint_entry(entry)
        if errs:
            for e in errs:
                print(f"  FAIL  {label}: {e}")
            total_errors += len(errs)
        else:
            print(f"  OK    {label}")
            entries_ok += 1

        # Duplicate check (only when id+version are valid strings).
        if isinstance(entry, dict):
            eid = entry.get("id")
            ver = entry.get("version")
            if isinstance(eid, str) and isinstance(ver, str):
                key = f"{eid}@{ver}"
                if key in seen:
                    print(
                        f"  FAIL  {label}: duplicate id@version "
                        f"(also at entry[{seen[key]}])"
                    )
                    total_errors += 1
                else:
                    seen[key] = i

    print(f"\n{entries_ok} ok, {total_errors} error(s) in {len(plugins)} entries")
    return 0 if total_errors == 0 else 1
