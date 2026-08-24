"""SidecarSupervisor — unified lifecycle for local helper subprocesses.

Owns start / stop / status / stop_all for every registered sidecar. Domains
(freemodel_bridge, turnstile_solver, ...) keep their own commands and domain
logic; only the process management lives here. Replaces the near-duplicated
module-level singleton lifecycle code that each service previously carried.

Status shape is the dict the existing callers already consume::

    {"status": "running"|"stopped"|"error", "port", "pid",
     "uptimeSeconds", "error"}

Concurrency: every mutation of a sidecar's process state is serialized by a
per-name ``asyncio.Lock``, so concurrent ``start``/``stop`` calls cannot orphan
processes. Subprocesses are launched in their own process group / session so
``stop`` can kill the whole tree (a sidecar such as the turnstile solver spawns
a browser child that must not be orphaned).
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from .spec import LaunchPlan, SidecarSpec

logger = logging.getLogger(__name__)


# ── child env allowlist ───────────────────────────────────────────────────
# Community plugins are unsigned arbitrary code; a ~10-line exfiltration of
# os.environ leaks FERNET_KEY, JWT_SECRET, IMAP_PASSWORD, API keys.  Children
# spawned by the supervisor receive ONLY these host vars (locale/Python
# tuning — none secret, none code-loading) plus the explicit plan.env
# overrides declared by each SidecarSpec.prepare().  Never add
# KEY/SECRET/PASSWORD/TOKEN/CREDENTIAL vars here; a sidecar needing a
# specific var must declare it in its own plan.env.
#
# Deliberately NOT inherited (constructed instead):
#   PATH      → reduced to the Python interpreter dir + OS system dirs
#               (:func:`_minimal_path`); the user's PATH may contain
#               attacker-writable dirs that shadow executables.
#   TEMP/TMP/HOME/USERPROFILE → replaced with a per-sidecar scoped temp dir
#               (:func:`_scoped_tmp_dir`) so children get an isolated
#               writable home/temp instead of the user's real profile dirs
#               (APPDATA/LOCALAPPDATA/PROGRAMDATA are NOT passed at all —
#               they are credential-bearing).
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
    children that need a writable home/temp get an isolated one instead of
    the user's real profile directories.
    """
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", name) or "sidecar"
    scoped = Path(tempfile.gettempdir()) / "sidecar-env" / safe / "tmp"
    scoped.mkdir(parents=True, exist_ok=True)
    return scoped


def _child_env(extra: dict[str, str], name: str) -> dict[str, str]:
    """Minimal env for child processes: allowlisted host vars + explicit extras.

    Boundary: the host's full environment (FERNET_KEY, JWT_SECRET,
    IMAP_PASSWORD, ...) must NOT leak into plugin/sidecar subprocesses —
    community plugins are unsigned code.  PATH is reconstructed minimal and
    TEMP/TMP/HOME/USERPROFILE are scoped per sidecar (see allowlist note).

    Honest limitation: this is defense-in-depth, not a sandbox.  On Linux a
    same-user process can still read the host's env via ``/proc/<ppid>/environ``
    — the allowlist stops *inherited* leakage into children, nothing stops a
    malicious child from reading its parent's procfs entry under the same uid.
    """
    env = {k: v for k, v in os.environ.items() if k in _CHILD_ENV_ALLOWLIST}
    env["PATH"] = _minimal_path()
    scoped = str(_scoped_tmp_dir(name))
    env["TEMP"] = scoped
    env["TMP"] = scoped
    if os.name == "nt":
        env["USERPROFILE"] = scoped
    else:
        env["HOME"] = scoped
    env.update(extra)
    return env


# ── opt-in privilege drop ──────────────────────────────────────────────────
# When STITCH_PLUGIN_RUN_AS_USER is set (POSIX only), plugin/sidecar
# subprocesses are spawned with ``user=<that user>`` so they run as a
# DIFFERENT (unprivileged) uid.  This is ADDITIVE defense-in-depth on top
# of the env allowlist and scoped TEMP — it does NOT replace them.
#
# Why a different uid is needed (Linux): a same-user child can read the
# parent's env via ``/proc/<ppid>/environ``, defeating the env allowlist.
# Running as a different uid closes that hole (the child cannot read a
# /proc entry owned by a different uid).  See
# ``docs/plugin-sandbox-isolation.md`` for the full write-up.
#
# One-time log guard so the Windows skip warning is not repeated per spawn.
_privilege_drop_windows_skip_logged: bool = False


def _privilege_drop_kwargs() -> dict[str, Any]:
    """Opt-in privilege-drop kwargs for plugin/sidecar subprocesses.

    Reads ``STITCH_PLUGIN_RUN_AS_USER``:

    - **Unset** → returns ``{}`` (behavior identical to pre-feature — no
      regression).
    - **Set + POSIX** (``sys.platform != "win32"``) → returns
      ``{"user": <value>}`` so children run as that user.  Only ``user=``
      is passed; the OS resolves the primary group from the user's passwd
      entry (no fabricated group).
    - **Set + Windows** → logs a one-time WARNING that privilege drop is
      POSIX-only (``subprocess.Popen(user=)`` raises on Windows) and
      returns ``{}`` (no regression, no failure).

    Failure semantics: if Popen raises because the target user doesn't
    exist or setuid is denied, the caller's ``except Exception`` path
    surfaces it as a spawn failure — there is NO silent fallback to a
    privileged spawn (that would defeat the purpose).
    """
    global _privilege_drop_windows_skip_logged
    run_as = os.environ.get("STITCH_PLUGIN_RUN_AS_USER")
    if not run_as:
        return {}
    if sys.platform == "win32":
        if not _privilege_drop_windows_skip_logged:
            logger.warning(
                "STITCH_PLUGIN_RUN_AS_USER=%s ignored: privilege drop is "
                "POSIX-only (subprocess.Popen(user=) raises on Windows). "
                "Continuing without privilege drop.",
                run_as,
            )
            _privilege_drop_windows_skip_logged = True
        return {}
    return {"user": run_as}


class _State:
    __slots__ = ("process", "port", "config", "start_time", "error", "lock")

    def __init__(self) -> None:
        # asyncio.subprocess.Process (stdio=devnull) or subprocess.Popen
        # (stdio=pipes — RPC plugins need sync stdin/stdout handles).
        self.process: asyncio.subprocess.Process | subprocess.Popen[bytes] | None = None
        self.port: int | None = None
        self.config: dict[str, Any] = {}
        self.start_time: float | None = None
        # Invariant: ``error`` is only meaningful when ``process`` is None.
        # ``stop`` clears it; ``status`` surfaces it only when not running.
        self.error: str | None = None
        # Serializes start/stop for this sidecar (asyncio.Lock is not
        # reentrant — internal helpers assume it is already held).
        self.lock = asyncio.Lock()


class SidecarSupervisor:
    """Manages all sidecar subprocesses for the application."""

    def __init__(self) -> None:
        self._specs: dict[str, SidecarSpec] = {}
        self._states: dict[str, _State] = {}

    # ── registration ────────────────────────────────────────────────────

    def register(self, spec: SidecarSpec) -> None:
        self._specs[spec.name] = spec
        self._states.setdefault(spec.name, _State())

    def is_registered(self, name: str) -> bool:
        return name in self._specs

    def names(self) -> list[str]:
        return list(self._specs.keys())

    # ── lifecycle ───────────────────────────────────────────────────────

    def is_running(self, name: str) -> bool:
        st = self._states.get(name)
        if not st or st.process is None:
            return False
        proc = st.process
        if isinstance(proc, subprocess.Popen):
            # Popen.returncode is stale until poll() is called.
            return proc.poll() is None
        return proc.returncode is None

    async def start(
        self, name: str, settings: dict | None = None, *, force: bool = False
    ) -> dict[str, Any]:
        spec = self._specs.get(name)
        if spec is None:
            return {
                "status": "error", "port": None, "pid": None,
                "uptimeSeconds": None, "error": f"unknown sidecar: {name}",
            }
        st = self._states[name]
        async with st.lock:
            running = st.process is not None and st.process.returncode is None
            if running and force:
                await self._stop_locked(name)
                await asyncio.sleep(0.3)
            elif running:
                return self.status(name)

            try:
                plan = spec.prepare(settings)
            except Exception as exc:  # noqa: BLE001
                st.error = str(exc)
                logger.error("[Sidecar:%s] prepare failed: %s", name, exc)
                return self.status(name)

            try:
                if plan.stdio == "pipes":
                    # RPC plugins need sync stdin/stdout PIPE handles for
                    # line-delimited JSON-RPC.  Spawn via subprocess.Popen
                    # (sync) so the caller can attach an RpcPluginClient reader
                    # thread to proc.stdout.  Process-group isolation is still
                    # applied so _terminate_tree can kill the whole tree.
                    proc = subprocess.Popen(
                        plan.command,
                        cwd=plan.cwd,
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        env=_child_env(plan.env, name),
                        **_subprocess_isolation_kwargs(),
                        **_privilege_drop_kwargs(),
                    )
                    st.process = proc
                    st.port = plan.port
                    st.config = dict(plan.config)
                    st.start_time = time.time()
                    st.error = None
                    logger.info(
                        "[Sidecar:%s] started pid=%s (stdio=pipes)", name, proc.pid
                    )
                    # No HTTP readiness gate for stdio plugins — the caller
                    # performs the RPC handshake and owns readiness.
                else:
                    program, *cmd_args = plan.command
                    st.process = await asyncio.create_subprocess_exec(
                        program,
                        *cmd_args,
                        cwd=plan.cwd,
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                        env=_child_env(plan.env, name),
                        **_subprocess_isolation_kwargs(),
                        **_privilege_drop_kwargs(),
                    )
                    st.port = plan.port
                    st.config = dict(plan.config)
                    st.start_time = time.time()
                    st.error = None
                    logger.info(
                        "[Sidecar:%s] started pid=%s port=%s", name, st.process.pid, plan.port
                    )
                    ready = await self._wait_for_ready(st, plan)
                    if not ready:
                        logger.warning(
                            "[Sidecar:%s] started but not ready within %.0fs — stopping it",
                            name, plan.readiness_timeout,
                        )
                        # Do not leave an unhealthy process running.
                        await self._stop_locked(name)
            except Exception as exc:  # noqa: BLE001
                run_as = os.environ.get("STITCH_PLUGIN_RUN_AS_USER")
                if run_as and sys.platform != "win32":
                    st.error = (
                        f"STITCH_PLUGIN_RUN_AS_USER={run_as} failed: {exc}"
                    )
                else:
                    st.error = str(exc)
                logger.error("[Sidecar:%s] failed to start: %s", name, exc, exc_info=True)
            return self.status(name)

    async def _wait_for_ready(self, st: _State, plan: LaunchPlan) -> bool:
        if not plan.health_url:
            return True
        deadline = time.time() + plan.readiness_timeout
        async with httpx.AsyncClient(timeout=2) as client:
            while time.time() < deadline:
                if st.process is not None and st.process.returncode is not None:
                    return False
                try:
                    resp = await client.get(plan.health_url)
                    if plan.health_ok(resp.status_code):
                        return True
                except (httpx.ConnectError, httpx.TimeoutException, OSError):
                    pass
                await asyncio.sleep(0.5)
        return False

    async def stop(self, name: str) -> dict[str, Any]:
        st = self._states.get(name)
        if st is None:
            return self.status(name)
        async with st.lock:
            return await self._stop_locked(name)

    async def _stop_locked(self, name: str) -> dict[str, Any]:
        """Stop logic; assumes ``st.lock`` is already held."""
        spec = self._specs.get(name)
        st = self._states.get(name)
        if st and st.process is not None and st.process.returncode is None:
            await self._terminate_tree(st.process, name)
            logger.info("[Sidecar:%s] stopped", name)
        if st:
            st.process = None
            st.start_time = None
            st.config = {}
            st.error = None
        if spec and spec.on_stop:
            try:
                spec.on_stop()
            except Exception as exc:  # noqa: BLE001
                logger.debug("[Sidecar:%s] on_stop hook error: %s", name, exc)
        return self.status(name)

    async def _terminate_tree(
        self, proc: asyncio.subprocess.Process | subprocess.Popen[bytes], name: str
    ) -> None:
        """Terminate a sidecar and its children (whole process group/tree).

        Sidecars such as the turnstile solver spawn a browser child; killing
        only the direct child would orphan it. On POSIX the child runs in its
        own session (``start_new_session``), so we signal the whole group. On
        Windows we use ``taskkill /T`` to kill the process tree.

        Handles both ``asyncio.subprocess.Process`` (stdio=devnull) and
        ``subprocess.Popen`` (stdio=pipes).  Popen's ``wait()`` is sync, so
        it is wrapped via ``asyncio.to_thread``.
        """
        pid = proc.pid
        if os.name == "posix":
            try:
                pgid = os.getpgid(pid)
            except (ProcessLookupError, PermissionError):
                pgid = None
            try:
                if pgid is not None:
                    os.killpg(pgid, signal.SIGTERM)
                else:
                    proc.terminate()
            except (ProcessLookupError, PermissionError):
                return
            try:
                await self._wait_proc_exit(proc, 5)
                return
            except TimeoutError:
                pass
            try:
                if pgid is not None:
                    os.killpg(pgid, signal.SIGKILL)
                else:
                    proc.kill()
            except (ProcessLookupError, PermissionError):
                return
            try:
                await self._wait_proc_exit(proc, 3)
            except TimeoutError:
                logger.error("[Sidecar:%s] SIGKILL did not terminate pid=%s", name, pid)
        else:  # Windows: kill the whole process tree.
            try:
                killer = await asyncio.create_subprocess_exec(
                    "taskkill", "/T", "/F", "/PID", str(pid),
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await asyncio.wait_for(killer.wait(), timeout=5)
            except Exception:  # noqa: BLE001
                try:
                    proc.kill()
                except ProcessLookupError:
                    return
            try:
                await self._wait_proc_exit(proc, 5)
            except TimeoutError:
                logger.error("[Sidecar:%s] taskkill did not terminate pid=%s", name, pid)

    @staticmethod
    async def _wait_proc_exit(
        proc: asyncio.subprocess.Process | subprocess.Popen[bytes], timeout: float
    ) -> None:
        """Wait for a process to exit, handling both async and sync types."""
        if isinstance(proc, subprocess.Popen):
            await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=timeout)
        else:
            await asyncio.wait_for(proc.wait(), timeout=timeout)

    async def stop_all(self) -> None:
        for name in list(self._specs.keys()):
            try:
                await self.stop(name)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[Sidecar:%s] stop failed during stop_all: %s", name, exc)

    # ── observation ─────────────────────────────────────────────────────

    def status(self, name: str) -> dict[str, Any]:
        st = self._states.get(name)
        if st is None:
            return {
                "status": "stopped", "port": None, "pid": None,
                "uptimeSeconds": None, "error": None,
            }
        if st.process is None:
            if st.error:
                return {
                    "status": "error", "port": None, "pid": None,
                    "uptimeSeconds": None, "error": st.error,
                }
            return {
                "status": "stopped", "port": st.port, "pid": None,
                "uptimeSeconds": None, "error": None,
            }
        proc = st.process
        # For Popen, poll() refreshes returncode; for asyncio Process it is
        # already up-to-date.
        if isinstance(proc, subprocess.Popen):
            rc = proc.poll()
        else:
            rc = proc.returncode
        if rc is not None:
            if rc != 0 and rc != -15:
                return {
                    "status": "error", "port": None, "pid": None,
                    "uptimeSeconds": None, "error": f"process exited with code {rc}",
                }
            return {
                "status": "stopped", "port": None, "pid": None,
                "uptimeSeconds": None, "error": None,
            }
        uptime = int(time.time() - st.start_time) if st.start_time else 0
        return {
            "status": "running", "port": st.port, "pid": proc.pid,
            "uptimeSeconds": uptime, "error": st.error,
        }

    def get_endpoint(self, name: str) -> str | None:
        """Base URL of a running sidecar, or None when not running.

        This is the ONLY thing AI providers / consumers should use — they never
        touch process details.
        """
        st = self._states.get(name)
        if not self.is_running(name) or not st or st.port is None:
            return None
        return f"http://127.0.0.1:{st.port}"

    def get_config(self, name: str) -> dict[str, Any]:
        """Return the last launch config recorded for a sidecar (may be empty)."""
        st = self._states.get(name)
        return dict(st.config) if st else {}

    def get_process(
        self, name: str
    ) -> asyncio.subprocess.Process | subprocess.Popen[bytes] | None:
        """Return the raw process handle for a sidecar (or None).

        For stdio=``pipes`` sidecars this is a ``subprocess.Popen`` whose
        ``stdin`` / ``stdout`` / ``stderr`` pipes the caller can attach an
        RPC client to.  For stdio=``devnull`` sidecars it is an
        ``asyncio.subprocess.Process``.
        """
        st = self._states.get(name)
        return st.process if st else None


def subprocess_isolation_kwargs() -> dict[str, Any]:
    """kwargs to run a sidecar in its own process group / session.

    Lets ``_terminate_tree`` kill the whole tree (sidecar + browser child).
    Public API: callers that spawn sidecar-like subprocesses outside the
    supervisor (e.g. ``ServicePluginHost`` for memory-capped children)
    should use this so the kill-tree contract is consistent.
    """
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


# Private alias retained for backward compatibility with callers that
# imported the underscore-prefixed name before it was promoted to public.
_subprocess_isolation_kwargs = subprocess_isolation_kwargs


# Eager singleton: created once at module import (atomic under the import
# lock), so there is no lazy-init race between concurrent get_supervisor()
# callers.
_supervisor = SidecarSupervisor()


def get_supervisor() -> SidecarSupervisor:
    """Return the process-wide singleton supervisor."""
    return _supervisor
