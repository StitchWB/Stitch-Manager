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
import signal
import subprocess
import time
from typing import Any

import httpx

from .spec import LaunchPlan, SidecarSpec

logger = logging.getLogger(__name__)


class _State:
    __slots__ = ("process", "port", "config", "start_time", "error", "lock")

    def __init__(self) -> None:
        self.process: asyncio.subprocess.Process | None = None
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
        return bool(st and st.process is not None and st.process.returncode is None)

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
                st.process = await asyncio.create_subprocess_exec(
                    *plan.command,
                    cwd=plan.cwd,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                    env={**os.environ, **plan.env},
                    **_subprocess_isolation_kwargs(),
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
        self, proc: asyncio.subprocess.Process, name: str
    ) -> None:
        """Terminate a sidecar and its children (whole process group/tree).

        Sidecars such as the turnstile solver spawn a browser child; killing
        only the direct child would orphan it. On POSIX the child runs in its
        own session (``start_new_session``), so we signal the whole group. On
        Windows we use ``taskkill /T`` to kill the process tree.
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
                await asyncio.wait_for(proc.wait(), timeout=5)
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
                await asyncio.wait_for(proc.wait(), timeout=3)
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
                await asyncio.wait_for(proc.wait(), timeout=5)
            except TimeoutError:
                logger.error("[Sidecar:%s] taskkill did not terminate pid=%s", name, pid)

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
        if st.process.returncode is not None:
            rc = st.process.returncode
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
            "status": "running", "port": st.port, "pid": st.process.pid,
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


def _subprocess_isolation_kwargs() -> dict[str, Any]:
    """kwargs to run a sidecar in its own process group / session.

    Lets ``_terminate_tree`` kill the whole tree (sidecar + browser child).
    """
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


# Eager singleton: created once at module import (atomic under the import
# lock), so there is no lazy-init race between concurrent get_supervisor()
# callers.
_supervisor = SidecarSupervisor()


def get_supervisor() -> SidecarSupervisor:
    """Return the process-wide singleton supervisor."""
    return _supervisor
