"""
Deferred cleanup queue for email resources.

Handles asynchronous cleanup of email aliases and resources with retry logic.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from queue import Empty, Queue
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .base import EmailContext, IEmailGenerator

logger = logging.getLogger(__name__)


@dataclass
class CleanupTask:
    """
    Task for deferred cleanup.

    Attributes:
        context: EmailContext to cleanup
        generator: Generator that created the email
        scheduled_at: When to execute cleanup
        max_retries: Maximum retry attempts
        retry_count: Current retry count
    """
    context: EmailContext
    generator: IEmailGenerator
    scheduled_at: datetime
    max_retries: int = 3
    retry_count: int = 0


class CleanupQueue:
    """
    Queue for deferred cleanup operations.

    Runs a background worker thread that processes cleanup tasks
    with retry logic and exponential backoff.
    """

    def __init__(self):
        """Initialize cleanup queue."""
        self.queue: Queue = Queue()
        self.running = False
        self.worker_thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def start(self):
        """Start worker thread."""
        with self._lock:
            if self.running:
                logger.warning("Cleanup queue already running")
                return

            self.running = True
            self.worker_thread = threading.Thread(
                target=self._worker,
                daemon=True,
                name="CleanupQueueWorker"
            )
            self.worker_thread.start()
            logger.info("Cleanup queue started")

    def schedule_cleanup(
        self,
        context: EmailContext,
        generator: IEmailGenerator,
        delay_seconds: int = 0
    ):
        """
        Schedule cleanup task.

        Args:
            context: EmailContext to cleanup
            generator: Generator that created the email
            delay_seconds: Delay before executing cleanup
        """
        if not self.running:
            logger.warning("Cleanup queue not running, starting it now")
            self.start()

        task = CleanupTask(
            context=context,
            generator=generator,
            scheduled_at=datetime.now() + timedelta(seconds=delay_seconds)
        )
        self.queue.put(task)
        logger.info(
            f"Scheduled cleanup for {context.email} "
            f"(delay: {delay_seconds}s, alias_id: {context.alias_id})"
        )

    def _worker(self):
        """Worker thread for processing cleanup tasks."""
        logger.info("Cleanup worker thread started")

        while self.running:
            try:
                # Get task with timeout to allow checking running flag
                try:
                    task = self.queue.get(timeout=1.0)
                except Empty:
                    continue

                # Wait until scheduled time
                wait_time = (task.scheduled_at - datetime.now()).total_seconds()
                if wait_time > 0:
                    logger.debug(f"Waiting {wait_time:.1f}s before cleanup")
                    time.sleep(wait_time)

                # Execute cleanup
                try:
                    logger.info(f"Executing cleanup for {task.context.email}")
                    task.generator.cleanup(task.context)
                    logger.info(f"Cleanup completed: {task.context.email}")

                except Exception as e:
                    logger.error(
                        f"Cleanup failed for {task.context.email}: {e}",
                        exc_info=True
                    )

                    # Retry if attempts remaining
                    if task.retry_count < task.max_retries:
                        task.retry_count += 1
                        # Exponential backoff: 60s, 120s, 240s
                        retry_delay = 60 * (2 ** (task.retry_count - 1))
                        task.scheduled_at = datetime.now() + timedelta(seconds=retry_delay)
                        self.queue.put(task)
                        logger.info(
                            f"Rescheduled cleanup for {task.context.email} "
                            f"(attempt {task.retry_count}/{task.max_retries}, "
                            f"delay: {retry_delay}s)"
                        )
                    else:
                        logger.error(
                            f"Cleanup failed permanently for {task.context.email} "
                            f"after {task.max_retries} attempts"
                        )

                finally:
                    self.queue.task_done()

            except Exception as e:
                logger.error(f"Unexpected error in cleanup worker: {e}", exc_info=True)
                continue

        logger.info("Cleanup worker thread stopped")

    def stop(self, timeout: float = 5.0):
        """
        Stop worker thread.

        Args:
            timeout: Maximum seconds to wait for thread to stop
        """
        with self._lock:
            if not self.running:
                logger.warning("Cleanup queue not running")
                return

            logger.info("Stopping cleanup queue")
            self.running = False

            if self.worker_thread:
                self.worker_thread.join(timeout=timeout)
                if self.worker_thread.is_alive():
                    logger.warning("Cleanup worker thread did not stop gracefully")
                else:
                    logger.info("Cleanup queue stopped")

    def pending_count(self) -> int:
        """
        Get number of pending cleanup tasks.

        Returns:
            Number of tasks in queue
        """
        return self.queue.qsize()


# Global cleanup queue instance.
# NOTE: not started here — auto-starts lazily on first schedule_cleanup() call.
# This avoids spawning a daemon thread on bare module import, which would hang
# subprocess-based tools (e.g. audit_contracts.py, pytest --forked) at exit.
cleanup_queue = CleanupQueue()
