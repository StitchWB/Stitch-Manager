"""Shared child-process environment contract for plugin/sidecar spawns.

Community plugins are unsigned arbitrary code: a ~10-line os.environ read
exfiltrates FERNET_KEY, JWT_SECRET, IMAP_PASSWORD, API keys.  Children get a
minimal allowlisted env, a reconstructed PATH, and a scoped temp/home dir; a
caller needing more passes it via ``extra``.
"""

from __future__ import annotations

import os
import re
import sys
import tempfile
from pathlib import Path

# Only non-secret, non-code-loading host vars; never add KEY/SECRET/PASSWORD/TOKEN/CREDENTIAL here.
CHILD_ENV_ALLOWLIST = frozenset({
    "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "COMSPEC",
    "TZ", "TERM", "SHELL",
    "LANG", "LC_ALL", "LC_CTYPE",
    "PYTHONIOENCODING", "PYTHONUTF8", "PYTHONDONTWRITEBYTECODE",
})


def minimal_path() -> str:
    """Reduced PATH: python interpreter dir + OS system dirs, never the user's PATH."""
    python_dir = os.path.dirname(sys.executable)
    if os.name == "nt":
        win_dir = os.environ.get("SYSTEMROOT", r"C:\Windows")
        return os.pathsep.join(
            [python_dir, os.path.join(win_dir, "System32"), win_dir]
        )
    return os.pathsep.join([python_dir, "/usr/local/bin", "/usr/bin", "/bin"])


def scoped_tmp_dir(name: str) -> Path:
    """Per-sidecar scoped temp dir: ``<temp-root>/sidecar-env/<name>/tmp``."""
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", name) or "sidecar"
    scoped = Path(tempfile.gettempdir()) / "sidecar-env" / safe / "tmp"
    scoped.mkdir(parents=True, exist_ok=True)
    return scoped


def build_child_env(
    extra: dict[str, str],
    *,
    temp_dir: Path | str,
    host_driver: bool = False,
    scope_home: bool = True,
) -> dict[str, str]:
    """Minimal env for child processes: allowlisted host vars + explicit extras.

    ``temp_dir`` is the caller-owned scoped temp dir.  ``host_driver=True``
    (entitled-only elevated trust) passes the real user TEMP/TMP through
    instead.  ``scope_home=True`` points HOME/USERPROFILE at ``temp_dir``;
    ``False`` inherits the real HOME on POSIX and sets nothing on Windows.
    """
    env = {k: v for k, v in os.environ.items() if k in CHILD_ENV_ALLOWLIST}
    env["PATH"] = minimal_path()
    if host_driver:
        temp = os.environ.get("TEMP") or tempfile.gettempdir()
    else:
        temp = str(temp_dir)
    env["TEMP"] = temp
    env["TMP"] = temp
    if scope_home:
        scoped = str(temp_dir)
        if os.name == "nt":
            env["USERPROFILE"] = scoped
        else:
            env["HOME"] = scoped
    elif os.name != "nt":
        home = os.environ.get("HOME")
        if home:
            env["HOME"] = home
    env.update(extra)
    return env
