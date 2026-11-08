"""Runtime detection for the ``wrap`` foreign-repo generator.

Classifies a local directory as ``python-module`` / ``python-script`` /
``cli`` / ``native`` and resolves the wrapped program's source path.
"""

from __future__ import annotations

import json
import os
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

RUNTIMES = ("auto", "python-module", "python-script", "cli", "native")

_MAIN_GUARD_RE = re.compile(r"""if\s+__name__\s*==\s*['"]__main__['"]""")

_CLI_MARKERS = ("[project.scripts]", "[tool.poetry.scripts]")
_NATIVE_SUFFIXES = (".exe", ".bat", ".cmd")


def _has_main_guard(path: Path) -> bool:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    return _MAIN_GUARD_RE.search(text) is not None


def _python_module_dir(repo_dir: Path) -> Path | None:
    if (repo_dir / "__main__.py").is_file():
        return repo_dir
    candidates = [
        d
        for d in sorted(repo_dir.iterdir())
        if d.is_dir() and (d / "__main__.py").is_file()
    ]
    return candidates[0] if len(candidates) == 1 else None


def _python_script(repo_dir: Path) -> Path | None:
    scripts = [p for p in sorted(repo_dir.glob("*.py")) if _has_main_guard(p)]
    return scripts[0] if scripts else None


def _package_bin_path(bin_field: object, package_name: object) -> str | None:
    if isinstance(bin_field, str) and bin_field:
        return bin_field
    if isinstance(bin_field, dict):
        if isinstance(package_name, str) and isinstance(bin_field.get(package_name), str):
            return bin_field[package_name]
        for value in bin_field.values():
            if isinstance(value, str) and value:
                return value
    return None


def _cli_entry(repo_dir: Path) -> tuple[Path, list[str] | None] | None:
    package_json = repo_dir / "package.json"
    if package_json.is_file():
        try:
            raw = json.loads(package_json.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raw = None
        if isinstance(raw, dict) and raw.get("bin"):
            bin_path = _package_bin_path(raw.get("bin"), raw.get("name"))
            argv = ["node", str((repo_dir / bin_path).resolve())] if bin_path else None
            return repo_dir, argv
    if (repo_dir / "go.mod").is_file() or (repo_dir / "Cargo.toml").is_file():
        return repo_dir, None
    pyproject = repo_dir / "pyproject.toml"
    if pyproject.is_file():
        text = pyproject.read_text(encoding="utf-8", errors="replace")
        if any(marker in text for marker in _CLI_MARKERS):
            return repo_dir, None
    shells = sorted(repo_dir.glob("*.sh"))
    if shells:
        return shells[0], ["bash", str(shells[0].resolve())]
    return None


def cli_argv(repo_dir: Path) -> list[str] | None:
    """Launch argv for a CLI repo, or None when it cannot be derived."""
    entry = _cli_entry(repo_dir)
    return entry[1] if entry is not None else None


def _native_entry(repo_dir: Path) -> Path | None:
    for path in sorted(repo_dir.iterdir()):
        if not path.is_file():
            continue
        if path.suffix.lower() in _NATIVE_SUFFIXES:
            return path
        if os.name != "nt" and not path.suffix and os.access(path, os.X_OK):
            return path
    return None


def detect_runtime(repo_dir: Path) -> tuple[str, Path]:
    """Detect the wrapped program's runtime and its source path.

    Order: a Python package with ``__main__.py`` -> ``python-module``; a
    top-level ``.py`` with a ``__main__`` guard -> ``python-script``; a
    CLI signal (``package.json`` bin, ``go.mod``, ``Cargo.toml``,
    ``pyproject.toml`` scripts, ``*.sh``) -> ``cli``; an executable file
    -> ``native``.  Raises ``ValueError`` when nothing matches.
    """
    module_dir = _python_module_dir(repo_dir)
    if module_dir is not None:
        return "python-module", module_dir
    script = _python_script(repo_dir)
    if script is not None:
        return "python-script", script
    cli = _cli_entry(repo_dir)
    if cli is not None:
        return "cli", cli[0]
    native = _native_entry(repo_dir)
    if native is not None:
        return "native", native
    raise ValueError(
        f"cannot detect a runtime for {repo_dir}: no Python package with "
        "__main__.py, no .py with a __main__ guard, and no CLI/native entry; "
        "pass --runtime explicitly"
    )


def explicit_source(repo_dir: Path, runtime: str) -> Path:
    """Resolve the source path for an explicitly chosen runtime (best-effort)."""
    if runtime == "python-module":
        return _python_module_dir(repo_dir) or repo_dir
    if runtime == "python-script":
        return _python_script(repo_dir) or repo_dir
    if runtime == "cli":
        entry = _cli_entry(repo_dir)
        return entry[0] if entry is not None else repo_dir
    return _native_entry(repo_dir) or repo_dir
