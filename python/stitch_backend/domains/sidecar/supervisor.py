"""SidecarSupervisor — unified lifecycle for local helper subprocesses.

Owns start / stop / status / stop_all for every registered sidecar. Domains
(turnstile_solver, plugin hosts, ...) keep their own commands and domain
logic; only the process management lives here.

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
import subprocess
import sys
import time
from typing import TYPE_CHECKING, Any

import httpx

from . import killtree as _killtree
from .env import _child_env
from .killtree import subprocess_isolation_kwargs as subprocess_isolation_kwargs
from .winjob import _assign_to_kill_job, _close_kill_job, _create_kill_job

if TYPE_CHECKING:
    from .spec import LaunchPlan, SidecarSpec

logger = logging.getLogger(__name__)


# Additive to the env allowlist: a different uid closes the Linux same-uid /proc/<ppid>/environ hole.
_privilege_drop_windows_skip_logged: bool = False


def _privilege_drop_kwargs() -> dict[str, Any]:
    """Opt-in privilege-drop kwargs for plugin/sidecar subprocesses.

    Reads ``STITCH_PLUGIN_RUN_AS_USER``:

    - **Unset** → returns ``{}`` (no ``user=`` kwarg is passed).
    - **Set + POSIX** (``sys.platform != "win32"``) → returns
      ``{"user": <value>}`` so children run as that user.  Only ``user=``
      is passed; the OS resolves the primary group from the user's passwd
      entry (no fabricated group).
    - **Set + Windows** → logs a one-time WARNING that privilege drop is
      POSIX-only (``subprocess.Popen(user=)`` raises on Windows) and
      returns ``{}`` (spawn proceeds without privilege drop).

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
    __slots__ = (
        "process", "port", "config", "start_time", "error", "lock",
        "pgid", "job",
    )

    def __init__(self) -> None:
        # asyncio Process (stdio=devnull) or subprocess.Popen (stdio=pipes; RPC needs sync stdin/stdout).
        self.process: asyncio.subprocess.Process | subprocess.Popen[bytes] | None = None
        self.port: int | None = None
        self.config: dict[str, Any] = {}
        self.start_time: float | None = None
        # error is meaningful only when process is None; stop clears it, status surfaces it.
        self.error: str | None = None
        # Per-sidecar start/stop serializer; asyncio.Lock is not reentrant, helpers assume it held.
        self.lock = asyncio.Lock()
        # Recorded at spawn: killpg on it reaches orphans later and never resolves a recycled pid.
        self.pgid: int | None = None
        # Windows KILL_ON_JOB_CLOSE handle (stdio=pipes); closing kills the whole tree. None on POSIX.
        self.job: Any = None


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

    def _record_tree_identity(self, st: _State, pid: int, name: str) -> None:
        """Record the handle ``_terminate_tree`` kills the whole tree with.

        The tree identity is captured AT SPAWN so the kill stays correct AND
        safe after the direct child dies (a cooperative plugin.shutdown):

        - POSIX: the process-group id.  Children are spawned with
          ``start_new_session=True`` and lead their new group, so
          ``pgid == pid`` — no syscall and no window in which the pid could
          be recycled before the group is known.  ``killpg`` on the recorded
          group reaches orphaned descendants and yields ESRCH once the tree
          is gone.
        - Windows: a ``KILL_ON_JOB_CLOSE`` Job Object containing the child.
          Every descendant the child spawns joins the job, and closing the
          supervisor's (last) handle at stop terminates all members — alive
          or orphaned — with no pid-based tree walk (which cannot reach
          orphans and can hit a recycled pid).  Best-effort: on failure the
          taskkill walk remains as the fallback for live processes.
        """
        if os.name == "posix":
            st.pgid = pid
            return
        try:
            job = _create_kill_job()
            try:
                _assign_to_kill_job(job, pid)
                st.job = job
            except Exception:  # noqa: BLE001
                _close_kill_job(job)
                raise
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[Sidecar:%s] kill-job unavailable, falling back to "
                "taskkill: %s", name, exc,
            )

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
                # _terminate_tree already waited the old process out; the respawn cannot race a live predecessor.
                await self._stop_locked(name)
            elif running:
                return self.status(name)
            elif force and st.process is not None:
                # Dead predecessor (crash-restart): sweep its tree via the recorded group/job before respawn.
                await self._terminate_tree(st.process, name)
                st.process = None
                st.pgid = None
                st.job = None

            try:
                plan = spec.prepare(settings)
            except Exception as exc:  # noqa: BLE001
                st.error = str(exc)
                logger.error("[Sidecar:%s] prepare failed: %s", name, exc)
                return self.status(name)

            try:
                if plan.stdio == "pipes":
                    # stdio=pipes: RPC plugins need sync PIPE handles for line-delimited JSON-RPC.
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
                    self._record_tree_identity(st, proc.pid, name)
                    st.port = plan.port
                    st.config = dict(plan.config)
                    st.start_time = time.time()
                    st.error = None
                    logger.info(
                        "[Sidecar:%s] started pid=%s (stdio=pipes)", name, proc.pid
                    )
                    # No HTTP readiness gate for stdio plugins — the caller owns readiness via the RPC handshake.
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
                    self._record_tree_identity(st, st.process.pid, name)
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
        """Stop logic; assumes ``st.lock`` is already held.

        The kill-tree runs whenever a process is recorded — INCLUDING when
        the direct child already exited.  A cooperative child (one that
        exits on ``plugin.shutdown``) can leave descendants alive; the
        recorded group (POSIX) / kill-job (Windows) reaches them, and is
        safe where a pid-based kill is not (the pid may already be
        recycled).  On a group/job with no live members the kill is a
        no-op (ESRCH), so this adds nothing for the common clean exit.
        """
        spec = self._specs.get(name)
        st = self._states.get(name)
        if st and st.process is not None:
            await self._terminate_tree(st.process, name)
            logger.info("[Sidecar:%s] stopped", name)
        if st:
            st.process = None
            st.pgid = None
            st.job = None
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
        await _killtree._terminate_tree(self._states.get(name), proc, name)

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
        # Popen: poll() refreshes returncode; asyncio Process returncode is already up-to-date.
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


# Backward-compat alias: existing callers import the underscore name.
_subprocess_isolation_kwargs = subprocess_isolation_kwargs


# Eager singleton: created at import under the import lock, so get_supervisor() has no lazy-init race.
_supervisor = SidecarSupervisor()


def get_supervisor() -> SidecarSupervisor:
    """Return the process-wide singleton supervisor."""
    return _supervisor
