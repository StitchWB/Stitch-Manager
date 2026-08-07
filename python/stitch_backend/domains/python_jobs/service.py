"""Python Jobs service — generic subprocess job management.

Ports Rust ``jobs::JobManager`` to Python.  Each job is a tracked
``asyncio.create_subprocess_exec`` with state, exit code, and optional
control-channel via a JSON command file.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ── Data ─────────────────────────────────────────────────────────────────────

@dataclass
class PythonJobState:
    id: str
    state: str  # queued | running | succeeded | failed | cancelled | timedout
    started_at: str = ""
    finished_at: str | None = None
    exit_code: int | None = None
    error: str | None = None
    correlation_id: str | None = None
    result_payload: Any | None = None
    _process: asyncio.subprocess.Process | None = field(default=None, repr=False)
    _script_path: str = ""
    _control_file: Path | None = field(default=None, repr=False)


# ── Manager ──────────────────────────────────────────────────────────────────

class PythonJobManager:
    """Manages Python subprocess jobs with state tracking."""

    def __init__(self) -> None:
        self._jobs: dict[str, PythonJobState] = {}

    async def start(
        self,
        script_path: str,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
        cwd: str | None = None,
        timeout_ms: int = 300_000,
        correlation_id: str | None = None,
        python_binary: str = "python",
    ) -> PythonJobState:
        """Spawn a Python subprocess and track it."""
        job_id = uuid.uuid4().hex[:12]
        now = _iso_now()

        # Prepare control file for command channel
        control_dir = Path.home() / ".stitch-manager" / "job_control"
        control_dir.mkdir(parents=True, exist_ok=True)
        control_file = control_dir / f"{job_id}.cmd.json"

        # Build environment
        proc_env = dict(os.environ)
        if env:
            proc_env.update(env)
        proc_env["STITCH_JOB_ID"] = job_id
        proc_env["STITCH_CONTROL_FILE"] = str(control_file)

        cmd = [python_binary, script_path] + (args or [])
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=proc_env,
            )
        except FileNotFoundError:
            job = PythonJobState(
                id=job_id,
                state="failed",
                started_at=now,
                finished_at=_iso_now(),
                exit_code=-1,
                error=f"Python binary not found: {python_binary}",
                correlation_id=correlation_id,
                _script_path=script_path,
                _control_file=control_file,
            )
            self._jobs[job_id] = job
            return job

        job = PythonJobState(
            id=job_id,
            state="running",
            started_at=now,
            correlation_id=correlation_id,
            _process=proc,
            _script_path=script_path,
            _control_file=control_file,
        )
        self._jobs[job_id] = job

        # Background monitor
        asyncio.create_task(self._monitor(job, timeout_ms))
        return job

    async def cancel(self, job_id: str) -> bool:
        """Cancel a running job."""
        job = self._jobs.get(job_id)
        if not job:
            return False
        if job.state not in ("queued", "running"):
            return False

        job.state = "cancelled"
        job.finished_at = _iso_now()

        proc = job._process
        if proc and proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
        return True

    def get_status(self, job_id: str) -> PythonJobState | None:
        """Return current job state."""
        return self._jobs.get(job_id)

    def send_control(self, job_id: str, command: str, payload: Any = None) -> bool:
        """Write a command to the job's control file."""
        job = self._jobs.get(job_id)
        if not job or not job._control_file:
            return False
        msg = {"command": command, "payload": payload, "ts": time.time()}
        try:
            job._control_file.write_text(json.dumps(msg), encoding="utf-8")
            return True
        except OSError as e:
            logger.warning("Failed to write control file for job %s: %s", job_id, e)
            return False

    async def _monitor(self, job: PythonJobState, timeout_ms: int) -> None:
        """Background task: wait for process completion or timeout."""
        proc = job._process
        if not proc:
            return

        timeout_secs = timeout_ms / 1000.0
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout_secs
            )
            job.exit_code = proc.returncode
            job.state = "succeeded" if proc.returncode == 0 else "failed"
            if proc.returncode != 0:
                job.error = stderr.decode("utf-8", errors="replace")[:2000]
            # Try to parse stdout as JSON result
            out = stdout.decode("utf-8", errors="replace").strip()
            if out:
                try:
                    job.result_payload = json.loads(out)
                except json.JSONDecodeError:
                    job.result_payload = out
        except TimeoutError:
            job.state = "timedout"
            job.error = f"Job timed out after {timeout_secs:.0f}s"
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        except Exception as e:
            job.state = "failed"
            job.error = str(e)

        job.finished_at = _iso_now()


# ── Singleton ────────────────────────────────────────────────────────────────

_instance: PythonJobManager | None = None


def get_job_manager() -> PythonJobManager:
    global _instance
    if _instance is None:
        _instance = PythonJobManager()
    return _instance


# ── Helpers ──────────────────────────────────────────────────────────────────

def _iso_now() -> str:
    from datetime import datetime
    return datetime.now(UTC).isoformat()
