"""Child-process environment construction for sidecar spawns.

Community plugins are unsigned arbitrary code: a ~10-line os.environ read
exfiltrates FERNET_KEY, JWT_SECRET, IMAP_PASSWORD, API keys.  Children get a
minimal allowlisted env, a reconstructed PATH, and a per-sidecar scoped
temp/home dir; a sidecar needing more must declare it in its plan.env.

The allowlist/PATH/scoping contract lives in ``autoreg.plugin.childenv`` so
the runtool playground and this supervisor cannot drift.
"""

from __future__ import annotations

from autoreg.plugin.childenv import build_child_env, scoped_tmp_dir


def _child_env(
    extra: dict[str, str], name: str, *, host_driver: bool = False
) -> dict[str, str]:
    """Minimal env for child processes: allowlisted host vars + explicit extras.

    Boundary: the host's full environment (FERNET_KEY, JWT_SECRET,
    IMAP_PASSWORD, ...) must NOT leak into plugin/sidecar subprocesses —
    community plugins are unsigned code.  PATH is reconstructed minimal and
    TEMP/TMP/HOME/USERPROFILE are scoped per sidecar.  ``host_driver=True``
    (entitled-only elevated trust) passes the real user TEMP/TMP through
    instead; HOME/USERPROFILE stay scoped for every plugin.

    Honest limitation: this is defense-in-depth, not a sandbox.  On Linux a
    same-user process can still read the host's env via ``/proc/<ppid>/environ``
    — the allowlist stops *inherited* leakage into children, nothing stops a
    malicious child from reading its parent's procfs entry under the same uid.
    """
    return build_child_env(
        extra,
        temp_dir=scoped_tmp_dir(name),
        host_driver=host_driver,
    )
