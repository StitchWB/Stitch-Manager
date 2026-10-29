"""KeyHealthProbeWorker — daily semantic probe sweep over active accounts.

Runs every ``interval_seconds`` (default 86400s = daily), iterates over
enabled credentials, and runs the semantic chat probe
(:mod:`stitch_backend.domains.key_health.probe`) for each.  The probe
re-reads the ``keyHealthProbeEnabled`` flag at execution time, so a disabled
flag makes the sweep a no-op with zero network calls.

Start/stop lifecycle::

    await KeyHealthProbeWorker.start()
    await KeyHealthProbeWorker.stop()
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from stitch_backend.database import run_in_read_session
from stitch_backend.domains.ai_gateway.models import Credential
from stitch_backend.domains.key_health.probe import is_probe_enabled, probe_credential

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class KeyHealthProbeWorker:
    """Daily semantic key-health probe loop."""

    _task: asyncio.Task[None] | None = None
    _interval_seconds: int = 86400

    # ── Lifecycle ────────────────────────────────────────────────────────────

    @classmethod
    async def start(cls, *, interval_seconds: int = 86400) -> None:
        """Start the daily probe loop."""
        if cls._task is not None:
            logger.warning("KeyHealthProbeWorker already running")
            return
        cls._interval_seconds = interval_seconds
        cls._task = asyncio.create_task(cls._loop())
        logger.info("KeyHealthProbeWorker started — interval=%ds", interval_seconds)

    @classmethod
    async def stop(cls) -> None:
        """Stop the daily probe loop."""
        if cls._task is None:
            return
        cls._task.cancel()
        try:
            await cls._task
        except asyncio.CancelledError:
            pass
        cls._task = None
        logger.info("KeyHealthProbeWorker stopped")

    @classmethod
    def status(cls) -> dict[str, Any]:
        return {
            "running": cls._task is not None and not cls._task.done(),
            "intervalSeconds": cls._interval_seconds,
        }

    # ── Loop ─────────────────────────────────────────────────────────────────

    @classmethod
    async def _loop(cls) -> None:
        while True:
            try:
                await asyncio.sleep(cls._interval_seconds)
                await cls._sweep_all()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("KeyHealthProbeWorker loop error — will retry")

    # ── Core sweep logic ─────────────────────────────────────────────────────

    @classmethod
    async def _sweep_all(cls) -> None:
        """Probe every enabled credential once.

        The flag is checked up front (execution-time read); when off the
        sweep returns before enumerating or probing anything.
        """
        start = time.monotonic()

        if not await run_in_read_session(is_probe_enabled):
            logger.debug("KeyHealthProbeWorker: probe disabled — skipping sweep")
            return

        async def _op(session: AsyncSession) -> list[str]:
            result = await session.execute(
                select(Credential.id).where(Credential.enabled.is_(True)),
            )
            return list(result.scalars().all())

        credential_ids = await run_in_read_session(_op)
        if not credential_ids:
            logger.debug("KeyHealthProbeWorker: no active credentials")
            return

        logger.info(
            "KeyHealthProbeWorker: sweeping %d active credentials",
            len(credential_ids),
        )

        for credential_id in credential_ids:
            try:
                await probe_credential(credential_id)
            except Exception:
                logger.exception(
                    "KeyHealthProbeWorker: failed for credential %s",
                    credential_id,
                )

        elapsed = time.monotonic() - start
        logger.info("KeyHealthProbeWorker: pass complete in %.1fs", elapsed)
