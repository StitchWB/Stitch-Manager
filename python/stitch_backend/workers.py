"""Periodic background loops started by the lifespan and cancelled on shutdown."""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


async def proxy_key_flush_loop() -> None:
    # The request path only accumulates in memory; this task is the sole writer of last_used_at.
    while True:
        await asyncio.sleep(10)
        try:
            from stitch_backend.database import run_in_session
            from stitch_backend.domains.ai_gateway.install_key_service import (
                flush_install_key_last_used_at,
            )
            from stitch_backend.domains.ai_gateway.service import flush_last_used_at

            # Shielded lifecycle: this task is cancelled on shutdown, so the
            # session must never see cancellation reach checkin/termination.
            async def _flush(session):
                await flush_last_used_at(session)
                await flush_install_key_last_used_at(session)

            await run_in_session(_flush)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("ProxyKey last_used_at flush failed")


async def group_usage_flush_loop() -> None:
    # The request path only accumulates in memory; this task is the sole writer of group_usage_by_model.
    while True:
        await asyncio.sleep(10)
        try:
            from stitch_backend.database import run_in_session
            from stitch_backend.domains.ai_gateway.usage_tracker import flush_group_usage

            # Shielded lifecycle — cancelled on shutdown, see proxy_key_flush_loop.
            await run_in_session(flush_group_usage)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("GroupUsage flush failed")


async def request_log_prune_loop() -> None:
    while True:
        await asyncio.sleep(3600)
        try:
            from stitch_backend.database import run_in_session
            from stitch_backend.domains.ai_proxy.request_logs import prune_request_logs

            # Shielded lifecycle — cancelled on shutdown, see proxy_key_flush_loop.
            await run_in_session(prune_request_logs)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Request log prune failed")


async def sandbox_idle_stop_loop() -> None:
    # Sandbox hosts start on-demand by routing, never at boot; idle hosts stay registered for cheap restart.
    while True:
        await asyncio.sleep(60)
        try:
            from stitch_backend.domains.plugin_runtime.sandbox import (
                stop_idle_hosts,
            )

            await stop_idle_hosts()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Sandbox idle-stop loop failed")


async def stop_task(task: asyncio.Task[None]) -> None:
    try:
        task.cancel()
        await task
    except (asyncio.CancelledError, Exception):
        pass
