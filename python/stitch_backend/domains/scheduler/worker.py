"""Background scheduler worker.

Periodically checks for pending tasks and executes them.
Mirrors the Rust ``services/scheduler/worker.rs``.
"""

from __future__ import annotations

import asyncio
import json
import logging

from stitch_backend.database import get_session_factory
from stitch_backend.domains.scheduler.service import (
    ScheduledTask,
    complete_execution,
    get_pending_tasks,
    start_execution,
    update_next_run,
)

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 30


class SchedulerWorker:
    """Asyncio-based scheduler worker that polls and executes pending tasks."""

    def __init__(self) -> None:
        self._running = False
        self._task: asyncio.Task[None] | None = None

    @property
    def is_running(self) -> bool:
        return self._running

    async def start(self) -> None:
        if self._running:
            logger.warning("[Scheduler] Already running")
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("[Scheduler] Worker started (poll every %ds)", POLL_INTERVAL_SECONDS)

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("[Scheduler] Worker stopped")

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._tick()
            except Exception:
                logger.exception("[Scheduler] Error in tick")
            await asyncio.sleep(POLL_INTERVAL_SECONDS)

    async def _tick(self) -> None:
        factory = get_session_factory()
        async with factory() as session:
            try:
                pending = await get_pending_tasks(session)
                for task in pending:
                    await self._execute_task(session, task)
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    async def _execute_task(self, session, task: ScheduledTask) -> None:
        logger.info("[Scheduler] Executing task: %s (id=%d, type=%s)", task.name, task.id, task.task_type.type)

        exec_id = await start_execution(session, task.id)
        await session.flush()

        try:
            result = await self._run_task(task)
            await complete_execution(session, exec_id, task.id, "Success", result, None)
        except Exception as exc:
            logger.error("[Scheduler] Task %d failed: %s", task.id, exc)
            await complete_execution(session, exec_id, task.id, "Failed", None, str(exc))

        # Reschedule (for interval/daily) or disable (for once)
        if task.schedule.type == "once":
            task.enabled = False
            await session.flush()
        else:
            await update_next_run(session, task.id, task.schedule)
            await session.flush()

    async def _run_task(self, task: ScheduledTask) -> str:
        """Execute the actual task logic."""
        tt = task.task_type
        config = json.loads(task.config) if task.config else {}

        if tt.type == "registerProvider":
            return await self._execute_register(tt.provider or "", config)
        elif tt.type == "loginAccount":
            return await self._execute_login(tt.account_id or 0, config)
        elif tt.type == "refreshToken":
            return await self._execute_refresh(tt.account_id or 0, config)
        elif tt.type == "customScript":
            return await self._execute_script(tt.script_path or "", config)
        else:
            return f"Unknown task type: {tt.type}"

    async def _execute_register(self, provider: str, config: dict) -> str:
        logger.info("[TaskExecutor] Registering provider: %s", provider)
        from stitch_backend.core.command_registry import get_command_handler
        try:
            handler = get_command_handler("register_provider")
            result = await handler(config)
            return json.dumps(result)
        except Exception as exc:
            raise RuntimeError(f"Registration failed: {exc}") from exc

    async def _execute_login(self, account_id: int, config: dict) -> str:
        logger.info("[TaskExecutor] Login account: %d", account_id)
        from stitch_backend.core.command_registry import get_command_handler
        try:
            handler = get_command_handler("login_account")
            result = await handler({"accountId": account_id, **config})
            return json.dumps(result)
        except Exception as exc:
            raise RuntimeError(f"Login failed: {exc}") from exc

    async def _execute_refresh(self, account_id: int, config: dict) -> str:
        logger.info("[TaskExecutor] Refresh token for account: %d", account_id)
        from stitch_backend.core.command_registry import get_command_handler
        try:
            handler = get_command_handler("refresh_oauth_token")
            result = await handler({"accountId": account_id, **config})
            return json.dumps(result)
        except Exception as exc:
            raise RuntimeError(f"Token refresh failed: {exc}") from exc

    async def _execute_script(self, script_path: str, config: dict) -> str:
        logger.info("[TaskExecutor] Running script: %s", script_path)
        try:
            proc = await asyncio.create_subprocess_exec(
                "python", script_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
            return stdout.decode(errors="replace")
        except asyncio.TimeoutError:
            raise RuntimeError("Script timed out after 300s") from None
        except Exception as exc:
            raise RuntimeError(f"Script execution failed: {exc}") from exc


async def execute_task_now(session, task: ScheduledTask) -> str:
    """Execute a task immediately (called from command handler)."""
    worker = SchedulerWorker()
    exec_id = await start_execution(session, task.id)
    await session.flush()

    try:
        result = await worker._run_task(task)
        await complete_execution(session, exec_id, task.id, "Success", result, None)
        await session.commit()
        return result
    except Exception as exc:
        await complete_execution(session, exec_id, task.id, "Failed", None, str(exc))
        await session.commit()
        raise


# Singleton
_worker: SchedulerWorker | None = None


def get_worker() -> SchedulerWorker:
    global _worker
    if _worker is None:
        _worker = SchedulerWorker()
    return _worker
