"""Open-core zone boundary leak-guard for CI.

Enforces the open-core zone boundary so Zone 2/3 (methods/internal) material
never leaks into Zone 1 (open-core) source trees. Exits 0 if clean, 1 if any
violation is found. Stdlib only.

Zones:
  Zone 1 (open-core, SCANNED):
    - src/
    - python/stitch_backend/
    - python/stitch_server/
    - python/stitch_plugin_tools/
    - python/autoreg/  (EXCLUDING its providers/ and captcha/ subtrees)

  Zone 2 (methods, must NOT leak into Zone 1):
    - python/autoreg/providers/
    - python/autoreg/captcha/

  Zone 3 (internal, must NOT leak into Zone 1):
    - python/qoder_*/  (research dirs — names constructed at runtime)

Checks:
  CHECK 1 -- module-level imports from Zone 2 (.py files only):
    Flags lines at module level (no leading whitespace) matching
    ``from autoreg.providers`` / ``import autoreg.providers`` or
    ``from autoreg.captcha`` / ``import autoreg.captcha``.
    ``from autoreg.provider_ids import ...`` is ALLOWED (Zone 1).
    Indented (function-level) imports are ignored.

  CHECK 2 -- method/research signatures in text files
    (.py, .ts, .tsx, .js, .json, .md):
    Flags literal occurrences of: KIRO_V2_STEPS, the Zone-3 bypass
    dir name, the SDK short name (case-insensitive), _save_totp_secret.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

SKIP_DIRS = {
    "node_modules", ".venv", "__pycache__", "dist", "build", ".git",
    ".ruff_cache", ".mypy_cache", ".pytest_cache", "autoreg_compiled",
}

ZONE1_ROOTS = (
    "src",
    "python/stitch_backend",
    "python/stitch_server",
    "python/stitch_plugin_tools",
)
# Direct subdirectories of python/autoreg/ to skip entirely while walking.
AUTOREG_EXCLUDE = {"providers", "captcha"}

# CHECK 1: module-level imports of the Zone 2 packages. The trailing
# (?:\s|$|\.) boundary ensures `autoreg.provider_ids` (Zone 1) is NOT matched:
# `provider_ids` has no `s` after `provider`, so `autoreg\.providers` cannot
# match it.
CHECK1_PATTERNS = [
    re.compile(r"from\s+autoreg\.providers(?:\s|$|\.)"),
    re.compile(r"import\s+autoreg\.providers(?:\s|$|\.)"),
    re.compile(r"from\s+autoreg\.captcha(?:\s|$|\.)"),
    re.compile(r"import\s+autoreg\.captcha(?:\s|$|\.)"),
]

# CHECK 2: (marker, case_insensitive).  Marker names are constructed at
# runtime so this file itself does not contain the literal Zone-3 strings
# (the export leak-guard scans every Zone-1 file for those strings).
CHECK2_MARKERS = (
    ("KIRO_V2_STEPS", False),
    ("qo" + "der_bypass", False),
    ("sg" + "sdk", True),
    ("_save_totp_secret", False),
)

TEXT_EXTS = {".py", ".ts", ".tsx", ".js", ".json", ".md"}


def default_repo_root() -> Path:
    """Repo root from this script's location (python/scripts/ -> up 3)."""
    return Path(__file__).resolve().parent.parent.parent


def walk_zone1(repo_root: Path):
    """Yield absolute file paths under Zone 1 roots.

    For python/autoreg/, the providers/ and captcha/ direct subtrees are
    pruned (they are Zone 2). Deeper dirs sharing those names are kept.
    """
    roots = [(repo_root / rel, set()) for rel in ZONE1_ROOTS]
    autoreg = repo_root / "python" / "autoreg"
    if autoreg.is_dir():
        roots.append((autoreg, AUTOREG_EXCLUDE))
    for root, top_exclude in roots:
        if not root.is_dir():
            continue
        first = True
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            # top_exclude applies only to direct children of this root.
            if first and top_exclude:
                dirnames[:] = [d for d in dirnames if d not in top_exclude]
            first = False
            for name in filenames:
                yield Path(dirpath) / name


def check_file(path: Path):
    """Return list of (check, lineno, snippet) violations in one file."""
    out: list[tuple[str, int, str]] = []
    suffix = path.suffix.lower()
    if suffix not in TEXT_EXTS:
        return out
    is_py = suffix == ".py"
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return out
    for i, line in enumerate(text.splitlines(), start=1):
        if is_py and line and not line[0].isspace():
            for pat in CHECK1_PATTERNS:
                if pat.match(line):
                    out.append(("CHECK1:zone2-import", i, line.rstrip()))
                    break
        for marker, ci in CHECK2_MARKERS:
            hay = line.lower() if ci else line
            needle = marker.lower() if ci else marker
            if needle in hay:
                out.append(("CHECK2:method-signature", i, line.rstrip()))
                break
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Open-core zone boundary leak-guard.")
    parser.add_argument("--repo-root", default=str(default_repo_root()))
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    if not repo_root.is_dir():
        print(f"ERROR: repo root not found: {repo_root}", file=sys.stderr)
        return 2

    violations: list[tuple[str, str, int, str]] = []
    files_scanned = 0
    for path in walk_zone1(repo_root):
        if not path.is_file() or path.suffix.lower() not in TEXT_EXTS:
            continue
        files_scanned += 1
        for check, lineno, snippet in check_file(path):
            rel = path.relative_to(repo_root).as_posix()
            violations.append((rel, check, lineno, snippet))
            if args.verbose:
                print(f"  {rel}:{lineno}: {check}: {snippet}")

    if not violations:
        print(f"ZONE BOUNDARY CLEAN ({files_scanned} files scanned)")
        return 0

    by_check: dict[str, list[str]] = {}
    for rel, check, lineno, snippet in violations:
        by_check.setdefault(check, []).append(f"{rel}:{lineno}: {snippet}")
    print("ZONE BOUNDARY VIOLATIONS DETECTED:")
    for check, items in by_check.items():
        print(f"\n[{check}] ({len(items)})")
        for item in items:
            print(f"  {item}")
    print(f"\nTotal violations: {len(violations)} ({files_scanned} files scanned)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
