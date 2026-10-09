"""Child-process environment construction for sidecar spawns.

Community plugins are unsigned arbitrary code: a ~10-line os.environ read
exfiltrates FERNET_KEY, JWT_SECRET, IMAP_PASSWORD, API keys.  Children get a
minimal allowlisted env, a reconstructed PATH, and a per-sidecar scoped
temp/home dir; a sidecar needing more must declare it in its plan.env.
"""

from __future__ import annotations

import os
import re
import sys
import tempfile
from pathlib import Path

# Only non-secret, non-code-loading host vars; never add KEY/SECRET/PASSWORD/TOKEN/CREDENTIAL here.
_CHILD_ENV_ALLOWLIST = frozenset({
    # Windows runtime (PATH/TEMP/TMP/USERPROFILE are constructed, not inherited)
    "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "COMSPEC",
    # POSIX runtime (HOME is constructed)
    "TZ", "TERM", "SHELL",
    # locale / encoding
    "LANG", "LC_ALL", "LC_CTYPE",
    # Python tuning (non-secret, no code-execution effect)
    "PYTHONIOENCODING", "PYTHONUTF8", "PYTHONDONTWRITEBYTECODE",
})


def _minimal_path() -> str:
    """Reduced PATH for children: python interpreter dir + OS system dirs.

    Never inherits the user's PATH — it may contain attacker-writable
    directories that shadow executables the child resolves by name.
    """
    python_dir = os.path.dirname(sys.executable)
    if os.name == "nt":
        win_dir = os.environ.get("SYSTEMROOT", r"C:\Windows")
        return os.pathsep.join(
            [python_dir, os.path.join(win_dir, "System32"), win_dir]
        )
    return os.pathsep.join([python_dir, "/usr/local/bin", "/usr/bin", "/bin"])


def _scoped_tmp_dir(name: str) -> Path:
    """Per-sidecar scoped temp dir: ``<temp-root>/sidecar-env/<name>/tmp``.

    Passed as TEMP/TMP (and HOME/USERPROFILE on the respective OS) so
    children that need a writable home/temp get an isolated one, never the
    user's real profile directories (APPDATA/LOCALAPPDATA/PROGRAMDATA are
    not passed at all — they are credential-bearing).
    """
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", name) or "sidecar"
    scoped = Path(tempfile.gettempdir()) / "sidecar-env" / safe / "tmp"
    scoped.mkdir(parents=True, exist_ok=True)
    return scoped


def _child_env(
    extra: dict[str, str], name: str, *, host_driver: bool = False
) -> dict[str, str]:
    """Minimal env for child processes: allowlisted host vars + explicit extras.

    Boundary: the host's full environment (FERNET_KEY, JWT_SECRET,
    IMAP_PASSWORD, ...) must NOT leak into plugin/sidecar subprocesses —
    community plugins are unsigned code.  PATH is reconstructed minimal and
    TEMP/TMP/HOME/USERPROFILE are scoped per sidecar (see allowlist note).
    ``host_driver=True`` (entitled-only elevated trust) passes the real
    user TEMP/TMP through instead; HOME/USERPROFILE stay scoped for every
    plugin.

    Honest limitation: this is defense-in-depth, not a sandbox.  On Linux a
    same-user process can still read the host's env via ``/proc/<ppid>/environ``
    — the allowlist stops *inherited* leakage into children, nothing stops a
    malicious child from reading its parent's procfs entry under the same uid.
    """
    env = {k: v for k, v in os.environ.items() if k in _CHILD_ENV_ALLOWLIST}
    env["PATH"] = _minimal_path()
    scoped = str(_scoped_tmp_dir(name))
    if host_driver:
        temp = os.environ.get("TEMP") or tempfile.gettempdir()
        env["TEMP"] = temp
        env["TMP"] = temp
    else:
        env["TEMP"] = scoped
        env["TMP"] = scoped
    if os.name == "nt":
        env["USERPROFILE"] = scoped
    else:
        env["HOME"] = scoped
    env.update(extra)
    return env
