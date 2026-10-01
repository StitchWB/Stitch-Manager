"""Process-tree lifecycle for sidecars: spawn isolation + whole-tree kill.

The kill targets the tree identity recorded at spawn — the POSIX process
group (start_new_session ⇒ pgid == child pid) or a Windows
KILL_ON_JOB_CLOSE Job Object — never a pid re-resolved at kill time, which
cannot reach orphaned descendants and could hit a recycled pid.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import subprocess
import sys
from typing import TYPE_CHECKING, Any

from .winjob import _close_kill_job

if TYPE_CHECKING:
    from .supervisor import _State

# Logger name pinned: log records must keep originating from the supervisor logger.
logger = logging.getLogger("stitch_backend.domains.sidecar.supervisor")


def subprocess_isolation_kwargs() -> dict[str, Any]:
    """kwargs to run a sidecar in its own process group / session.

    Lets ``_terminate_tree`` kill the whole tree (sidecar + browser child).
    Public API: callers that spawn sidecar-like subprocesses outside the
    supervisor (e.g. ``ServicePluginHost`` for memory-capped children)
    should use this so the kill-tree contract is consistent.
    """
    # Both conjuncts required: os.name guards tests faking sys.platform="win32" on POSIX, sys.platform lets mypy narrow.
    if sys.platform == "win32" and os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


async def _wait_proc_exit(
    proc: asyncio.subprocess.Process | subprocess.Popen[bytes], timeout: float
) -> None:
    """Wait for a process to exit, handling both async and sync types."""
    if isinstance(proc, subprocess.Popen):
        await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=timeout)
    else:
        await asyncio.wait_for(proc.wait(), timeout=timeout)


async def _terminate_tree(
    st: _State | None,
    proc: asyncio.subprocess.Process | subprocess.Popen[bytes],
    name: str,
) -> None:
    """Terminate a sidecar and its children (whole process group/tree).

    Sidecars such as the turnstile solver spawn a browser child; killing
    only the direct child would orphan it.  The kill targets the tree
    identity recorded AT SPAWN — the process group on POSIX
    (start_new_session ⇒ pgid == child pid) and a KILL_ON_JOB_CLOSE Job
    Object on Windows — never resolving the pid at kill time: the
    recorded identity still reaches orphaned descendants when the direct
    child already exited, and never resolves a possibly-recycled pid to
    a foreign group/tree.

    Handles both ``asyncio.subprocess.Process`` (stdio=devnull) and
    ``subprocess.Popen`` (stdio=pipes).  Popen's ``wait()`` is sync, so
    it is wrapped via ``asyncio.to_thread``.
    """
    pid = proc.pid
    if sys.platform != "win32":
        # Recorded-at-spawn group first; probe a LIVE process only when nothing was recorded (legacy/test states).
        pgid = st.pgid if st is not None else None
        if pgid is None and proc.returncode is None:
            try:
                pgid = os.getpgid(pid)
            except (ProcessLookupError, PermissionError):
                pgid = None
        # Never signal our own group; pgid > 0 also rejects fake/test pids (kernel pgids are positive).
        own_pgid = os.getpgrp()
        safe_pgid = (
            pgid
            if (pgid is not None and pgid > 0 and pgid != own_pgid)
            else None
        )
        if safe_pgid is None and proc.returncode is not None:
            # Already dead and no group recorded — nothing safe to kill.
            return
        try:
            if safe_pgid is not None:
                os.killpg(safe_pgid, signal.SIGTERM)
            else:
                proc.terminate()
        except (ProcessLookupError, PermissionError):
            return
        try:
            await _wait_proc_exit(proc, 5)
        except TimeoutError:
            try:
                if safe_pgid is not None:
                    os.killpg(safe_pgid, signal.SIGKILL)
                else:
                    proc.kill()
            except (ProcessLookupError, PermissionError):
                return
            try:
                await _wait_proc_exit(proc, 3)
            except TimeoutError:
                logger.error(
                    "[Sidecar:%s] SIGKILL did not terminate pid=%s", name, pid
                )
                return
        # Sweep SIGTERM-ignoring descendants (direct child already gone); ESRCH is the common clean exit.
        if safe_pgid is not None:
            try:
                os.killpg(safe_pgid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
    else:  # Windows: kill the whole process tree.
        job = st.job if st is not None else None
        if job is not None:
            # Closing the last job handle kills all members, alive or orphaned — no pid walk, no recycled-pid hazard.
            try:
                _close_kill_job(job)
            except Exception:  # noqa: BLE001 — best-effort during teardown
                logger.debug("[Sidecar:%s] kill-job close failed", name)
            if st is not None:
                st.job = None
            try:
                await _wait_proc_exit(proc, 5)
            except TimeoutError:
                logger.error(
                    "[Sidecar:%s] kill-job close did not terminate pid=%s",
                    name, pid,
                )
            return
        if proc.returncode is not None:
            # Already dead without a kill-job: taskkill from this pid could hit a recycled pid.
            return
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
            await _wait_proc_exit(proc, 5)
        except TimeoutError:
            logger.error("[Sidecar:%s] taskkill did not terminate pid=%s", name, pid)
