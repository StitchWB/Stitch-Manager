"""JobManager — concurrent registration queue with progress tracking.

Manages multiple registration jobs running concurrently with a configurable
semaphore limit.  Each job's progress is streamed to the frontend via
EventBus WebSocket broadcast.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from stitch_backend.core.event_bus import event_bus
from stitch_backend.core.exceptions import JobNotFoundError
from stitch_backend.core.types import JobStatus, RegContext
from stitch_backend.domains.registration.orchestrator import RegistrationOrchestrator

logger = logging.getLogger(__name__)


# ── Job dataclass ───────────────────────────────────────────────────────────

@dataclass
class RegistrationJob:
    """State for a single registration job."""

    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    provider_id: str = ""
    status: JobStatus = JobStatus.PENDING
    progress: float = 0.0
    message: str = ""
    step: str = ""
    error: str | None = None
    result: dict[str, Any] | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None = None
    finished_at: datetime | None = None
    retry_count: int = 0
    max_retries: int = 3

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "providerId": self.provider_id,
            "status": self.status.value,
            "progress": self.progress,
            "message": self.message,
            "step": self.step,
            "error": self.error,
            "result": self.result,
            "createdAt": self.created_at.isoformat(),
            "startedAt": self.started_at.isoformat() if self.started_at else None,
            "finishedAt": self.finished_at.isoformat() if self.finished_at else None,
            "retryCount": self.retry_count,
        }


# ── JobManager ──────────────────────────────────────────────────────────────

class JobManager:
    """Concurrent registration job queue."""

    def __init__(self, max_concurrency: int = 3) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._jobs: dict[str, RegistrationJob] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._orchestrator = RegistrationOrchestrator()

    # ── Submit ──────────────────────────────────────────────────────────────

    async def submit(
        self,
        provider_id: str,
        email: str = "",
        password: str = "",
        max_retries: int = 3,
    ) -> RegistrationJob:
        """Create and enqueue a new registration job."""
        job = RegistrationJob(
            provider_id=provider_id,
            max_retries=max_retries,
        )
        self._jobs[job.id] = job

        ctx = RegContext(
            provider_id=provider_id,
            email=email,
            password=password,
        )

        task = asyncio.create_task(self._execute(job, ctx))
        self._tasks[job.id] = task

        await event_bus.emit("job.submitted", {"job_id": job.id, "provider_id": provider_id})
        logger.info("Job %s submitted for provider=%s", job.id, provider_id)
        return job

    async def submit_batch(self, provider_id: str, count: int) -> list[RegistrationJob]:
        """Submit multiple jobs for the same provider."""
        jobs = []
        for _ in range(count):
            job = await self.submit(provider_id=provider_id)
            jobs.append(job)
        return jobs

    # ── Query ───────────────────────────────────────────────────────────────

    def get_job(self, job_id: str) -> RegistrationJob:
        if job_id not in self._jobs:
            raise JobNotFoundError(job_id)
        return self._jobs[job_id]

    def list_jobs(self, status: str | None = None) -> list[RegistrationJob]:
        jobs = list(self._jobs.values())
        if status:
            jobs = [j for j in jobs if j.status.value == status]
        return sorted(jobs, key=lambda j: j.created_at, reverse=True)

    # ── Cancel ──────────────────────────────────────────────────────────────

    async def cancel(self, job_id: str) -> None:
        if job_id not in self._tasks:
            raise JobNotFoundError(job_id)
        self._tasks[job_id].cancel()
        self._jobs[job_id].status = JobStatus.CANCELLED
        self._jobs[job_id].finished_at = datetime.now(timezone.utc)
        await event_bus.emit("job.cancelled", {"job_id": job_id})
        logger.info("Job %s cancelled", job_id)

    # ── Internal execution ──────────────────────────────────────────────────

    async def _execute(self, job: RegistrationJob, ctx: RegContext) -> None:
        """Run a job with concurrency limit and retry logic."""
        async with self._semaphore:
            job.status = JobStatus.RUNNING
            job.started_at = datetime.now(timezone.utc)
            await event_bus.emit("job.started", {"job_id": job.id})

            try:
                # Resolve provider
                from stitch_backend.core.command_registry import get_provider
                provider_cls = get_provider(job.provider_id)
                provider = provider_cls()

                # Run orchestrator
                result = await self._orchestrator.run(
                    provider=provider,
                    ctx=ctx,
                    job_id=job.id,
                )

                if result.get("success"):
                    job.status = JobStatus.SUCCESS
                    job.progress = 1.0
                    job.result = result
                else:
                    raise Exception(result.get("error", "Unknown registration error"))

            except asyncio.CancelledError:
                job.status = JobStatus.CANCELLED
                logger.info("Job %s cancelled during execution", job.id)
            except Exception as exc:
                if job.retry_count < job.max_retries:
                    job.retry_count += 1
                    logger.info(
                        "Job %s retrying (%d/%d): %s",
                        job.id, job.retry_count, job.max_retries, exc,
                    )
                    await asyncio.sleep(2 ** job.retry_count)  # Exponential backoff
                    # Re-execute (without re-acquiring semaphore since we're still inside)
                    await self._execute_inner(job, ctx)
                else:
                    job.status = JobStatus.FAILED
                    job.error = str(exc)
                    logger.error("Job %s failed permanently: %s", job.id, exc)
            finally:
                job.finished_at = datetime.now(timezone.utc)
                await event_bus.emit("job.finished", {
                    "job_id": job.id,
                    "status": job.status.value,
                    "error": job.error,
                })

    async def _execute_inner(self, job: RegistrationJob, ctx: RegContext) -> None:
        """Retry path — no semaphore acquisition."""
        try:
            from stitch_backend.core.command_registry import get_provider
            provider_cls = get_provider(job.provider_id)
            provider = provider_cls()

            result = await self._orchestrator.run(
                provider=provider, ctx=ctx, job_id=job.id,
            )
            if result.get("success"):
                job.status = JobStatus.SUCCESS
                job.progress = 1.0
                job.result = result
            else:
                raise Exception(result.get("error", "Unknown error"))
        except Exception as exc:
            if job.retry_count < job.max_retries:
                job.retry_count += 1
                await asyncio.sleep(2 ** job.retry_count)
                await self._execute_inner(job, ctx)
            else:
                job.status = JobStatus.FAILED
                job.error = str(exc)


# ── Global singleton ────────────────────────────────────────────────────────

from stitch_backend.config import get_settings

_settings = get_settings()
job_manager = JobManager(max_concurrency=_settings.reg_max_concurrency)
