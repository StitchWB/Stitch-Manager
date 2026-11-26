"""Regression tests: backend-spawned Python children use the backend interpreter.

Bare ``python`` resolves through PATH on Windows and silently moves children
from the application venv/bundle onto a system Python with different packages.
"""

from __future__ import annotations

import asyncio
import sys
from types import SimpleNamespace

from stitch_backend.domains.python_jobs.commands import (
    cmd_run_python_script,
    cmd_start_python_job,
)
from stitch_backend.domains.python_jobs.service import PythonJobManager
from stitch_backend.domains.scheduler.worker import SchedulerWorker


class _FakeProcess:
    def __init__(self) -> None:
        self.returncode = 0

    async def communicate(self) -> tuple[bytes, bytes]:
        return b"ok", b""


async def test_python_job_manager_defaults_to_sys_executable(monkeypatch) -> None:
    captured: list[tuple[object, ...]] = []

    async def fake_exec(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        captured.append(args)
        return _FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    job = await PythonJobManager().start("worker.py")

    assert job.state == "running"
    assert captured
    assert captured[0][0] == sys.executable
    assert captured[0][1] == "worker.py"
    await asyncio.sleep(0)  # let the monitor task finish with the fake process


async def test_start_python_job_command_defaults_to_sys_executable(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeManager:
        async def start(self, **kwargs):  # noqa: ANN003, ANN202
            captured.update(kwargs)
            return SimpleNamespace(id="job-1")

    monkeypatch.setattr(
        "stitch_backend.domains.python_jobs.service.get_job_manager",
        lambda: FakeManager(),
    )

    result = await cmd_start_python_job({"scriptPath": "python/run_job.py"})

    assert result == {"jobId": "job-1"}
    assert captured["python_binary"] == sys.executable


async def test_run_python_script_defaults_to_sys_executable(monkeypatch) -> None:
    captured: list[tuple[object, ...]] = []

    async def fake_exec(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        captured.append(args)
        return _FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    output = await cmd_run_python_script({"scriptPath": "worker.py"})

    assert output == "ok"
    assert captured
    assert captured[0][0] == sys.executable


async def test_scheduler_custom_script_uses_sys_executable(monkeypatch) -> None:
    captured: list[tuple[object, ...]] = []

    async def fake_exec(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        captured.append(args)
        return _FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    output = await SchedulerWorker()._execute_script("scheduled.py", {})

    assert output == "ok"
    assert captured
    assert captured[0][0] == sys.executable
    assert captured[0][1] == "scheduled.py"
